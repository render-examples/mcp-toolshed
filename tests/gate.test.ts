import { describe, expect, it } from "vitest";
import {
	ProviderBusyError,
	ProviderGate,
	ProviderTimeoutError,
	ProviderUnavailableError,
} from "../toolshed/gate.js";

describe("ProviderGate", () => {
	it("serializes concurrent work", async () => {
		const gate = new ProviderGate();
		const order: number[] = [];
		const first = gate.run(async () => {
			await sleep(20);
			order.push(1);
			return 1;
		});
		const second = gate.run(async () => {
			order.push(2);
			return 2;
		});
		await Promise.all([first, second]);
		expect(order).toEqual([1, 2]);
	});

	it("rejects calls when the queue is full", async () => {
		const gate = new ProviderGate(1);
		const first = gate.run(async () => {
			await sleep(20);
			return 1;
		});
		await expect(gate.run(async () => 2)).rejects.toBeInstanceOf(
			ProviderBusyError,
		);
		await first;
	});

	it("aborts calls at their deadline", async () => {
		const gate = new ProviderGate();
		await expect(
			gate.run(
				(signal) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => reject(new Error("aborted")),
							{ once: true },
						);
					}),
				5,
			),
		).rejects.toBeInstanceOf(ProviderTimeoutError);
	});

	it("rejects new work while a timed-out operation ignores cancellation", async () => {
		const gate = new ProviderGate();
		let release!: () => void;
		const blocked = gate.run(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
			5,
		);
		const queued = gate.run(async () => "queued");
		await expect(blocked).rejects.toBeInstanceOf(ProviderTimeoutError);
		await expect(queued).rejects.toBeInstanceOf(ProviderUnavailableError);
		await expect(gate.run(async () => "next")).rejects.toBeInstanceOf(
			ProviderUnavailableError,
		);
		release();
		await sleep(0);
		await expect(gate.run(async () => "recovered")).resolves.toBe("recovered");
	});
});

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
