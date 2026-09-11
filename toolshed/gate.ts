/** Serialize async work per provider — upstream MCP clients are not concurrency-safe. */
export class ProviderGate {
	private tail: Promise<void> = Promise.resolve();

	run<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.tail.then(fn);
		this.tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}
