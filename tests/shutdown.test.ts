import { afterEach, describe, expect, it, vi } from "vitest";
import { closeServer } from "../toolshed/shutdown.js";

afterEach(() => {
	vi.useRealTimers();
});

describe("closeServer", () => {
	it("waits for the server close callback", async () => {
		let callback: ((error?: Error) => void) | undefined;
		const closing = closeServer(
			{
				close: (next) => {
					callback = next;
				},
			},
			1_000,
		);
		let finished = false;
		void closing.then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		callback?.();
		await closing;
		expect(finished).toBe(true);
	});

	it("forces lingering connections closed at the deadline", async () => {
		vi.useFakeTimers();
		const closeAllConnections = vi.fn();
		const closing = closeServer(
			{ close: () => undefined, closeAllConnections },
			100,
		);
		await vi.advanceTimersByTimeAsync(100);
		await closing;
		expect(closeAllConnections).toHaveBeenCalledOnce();
	});
});
