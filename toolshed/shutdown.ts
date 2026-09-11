export interface ClosableServer {
	close(callback: (error?: Error) => void): void;
	closeAllConnections?: () => void;
}

export function closeServer(
	server: ClosableServer,
	timeoutMs = 10_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(forceClose);
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};
		const forceClose = setTimeout(() => {
			console.warn("forcing remaining HTTP connections closed");
			server.closeAllConnections?.();
			finish();
		}, timeoutMs);
		forceClose.unref();
		server.close(finish);
	});
}
