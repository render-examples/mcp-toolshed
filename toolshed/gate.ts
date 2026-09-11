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
	private readonly queue: Array<{
		fn: (signal: AbortSignal) => Promise<unknown>;
		timeoutMs: number;
		resolve: (value: unknown) => void;
		reject: (reason?: unknown) => void;
	}> = [];
	private pending = 0;
	private active = false;
	private unavailable = false;

	constructor(private readonly maxPending = DEFAULT_MAX_PENDING) {}

	run<T>(
		fn: (signal: AbortSignal) => Promise<T>,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<T> {
		if (this.unavailable) {
			return Promise.reject(new ProviderUnavailableError());
		}
		if (this.pending >= this.maxPending) {
			return Promise.reject(new ProviderBusyError(this.maxPending));
		}
		this.pending++;
		const run = new Promise<T>((resolve, reject) => {
			this.queue.push({
				fn,
				timeoutMs,
				resolve: (value) => resolve(value as T),
				reject,
			});
		});
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
		const controller = new AbortController();
		let returned = false;
		const timeout = setTimeout(() => {
			returned = true;
			this.unavailable = true;
			task.reject(new ProviderTimeoutError(task.timeoutMs));
			controller.abort();
			for (const queued of this.queue.splice(0)) {
				queued.reject(new ProviderUnavailableError());
				this.pending--;
			}
		}, task.timeoutMs);
		try {
			const value = await task.fn(controller.signal);
			if (!returned) {
				returned = true;
				task.resolve(value);
			}
		} catch (error) {
			if (!returned) {
				returned = true;
				task.reject(error);
			}
		} finally {
			clearTimeout(timeout);
			this.pending--;
			this.active = false;
			this.unavailable = false;
			this.drain();
		}
	}
}
