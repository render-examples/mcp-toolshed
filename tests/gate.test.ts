import { describe, expect, it } from "vitest";
import { ProviderGate } from "../toolshed/gate.js";

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
});

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
