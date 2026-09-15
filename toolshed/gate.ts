const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PENDING = 100;

export class ProviderBusyError extends Error {
	constructor(maxPending: number) {
		super(`provider queue is full (${maxPending} pending calls)`);
		this.name = "ProviderBusyError";
	}
}

export class ProviderTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`provider call timed out after ${timeoutMs}ms`);
		this.name = "ProviderTimeoutError";
	}
}

export class ProviderUnavailableError extends Error {
	constructor() {
		super("provider is unavailable while a timed-out call is still running");
		this.name = "ProviderUnavailableError";
	}
}

/** Serialize bounded async work per provider. */
export class ProviderGate {
	private readonly queue: GateTask[] = [];
	private pending = 0;
	private active = false;
	private unavailable = false;

	constructor(private readonly maxPending = DEFAULT_MAX_PENDING) {}

	run<T>(
		fn: (signal: AbortSignal) => Promise<T>,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal?: AbortSignal,
	): Promise<T> {
		if (this.unavailable) {
			return Promise.reject(new ProviderUnavailableError());
		}
		if (signal?.aborted) {
			return Promise.reject(abortError());
		}
		if (this.pending >= this.maxPending) {
			return Promise.reject(new ProviderBusyError(this.maxPending));
		}
		this.pending++;
		let task!: GateTask;
		const run = new Promise<T>((resolve, reject) => {
			task = {
				fn,
				timeoutMs,
				resolve: (value) => resolve(value as T),
				reject,
				controller: new AbortController(),
				state: "queued",
				promiseSettled: false,
			};
		});
		task.timeout = setTimeout(() => this.expire(task), timeoutMs);
		if (signal) {
			task.externalSignal = signal;
			task.onExternalAbort = () => this.cancel(task);
			signal.addEventListener("abort", task.onExternalAbort, { once: true });
		}
		this.queue.push(task);
		this.drain();
		return run;
	}

	private drain(): void {
		if (this.active || this.unavailable) {
			return;
		}
		const task = this.queue.shift();
		if (!task) {
			return;
		}
		this.active = true;
		void this.execute(task);
	}

	private async execute(task: (typeof this.queue)[number]): Promise<void> {
		task.state = "active";
		try {
			const value = await task.fn(task.controller.signal);
			if (!task.promiseSettled) {
				task.promiseSettled = true;
				task.resolve(value);
			}
		} catch (error) {
			if (!task.promiseSettled) {
				task.promiseSettled = true;
				task.reject(error);
			}
		} finally {
			this.cleanup(task);
			task.state = "done";
			this.pending--;
			this.active = false;
			this.unavailable = false;
			this.drain();
		}
	}

	private expire(task: GateTask): void {
		this.rejectTask(task, new ProviderTimeoutError(task.timeoutMs));
	}

	private cancel(task: GateTask): void {
		this.rejectTask(task, abortError());
	}

	private rejectTask(task: GateTask, error: Error): void {
		if (task.state === "done" || task.promiseSettled) {
			return;
		}
		task.promiseSettled = true;
		task.reject(error);
		task.controller.abort();
		if (task.state === "queued") {
			const index = this.queue.indexOf(task);
			if (index >= 0) {
				this.queue.splice(index, 1);
			}
			this.cleanup(task);
			task.state = "done";
			this.pending--;
			this.drain();
			return;
		}
		this.unavailable = true;
		for (const queued of this.queue.splice(0)) {
			if (!queued.promiseSettled) {
				queued.promiseSettled = true;
				queued.reject(new ProviderUnavailableError());
			}
			queued.controller.abort();
			this.cleanup(queued);
			queued.state = "done";
			this.pending--;
		}
	}

	private cleanup(task: GateTask): void {
		if (task.timeout) {
			clearTimeout(task.timeout);
		}
		if (task.externalSignal && task.onExternalAbort) {
			task.externalSignal.removeEventListener("abort", task.onExternalAbort);
		}
	}
}

interface GateTask {
	fn: (signal: AbortSignal) => Promise<unknown>;
	timeoutMs: number;
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	controller: AbortController;
	state: "queued" | "active" | "done";
	promiseSettled: boolean;
	timeout?: ReturnType<typeof setTimeout>;
	externalSignal?: AbortSignal;
	onExternalAbort?: () => void;
}

function abortError(): DOMException {
	return new DOMException("The operation was aborted", "AbortError");
}
