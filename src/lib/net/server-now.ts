// The server's clock for code that cannot be handed the connection: the lightning schedule (the
// weather's, the effect props'), which every client must work out from the same time (#323). The
// room page sets it (audio/weather-sound.ts `hear`, which it calls with each change); until then
// it is this machine's clock. Lazy-loaded with the renderer's `vfx` chunk, never the shared one.

let clock: () => number = Date.now;

/** Server time, ms since epoch. */
export const serverNow = (): number => clock();

/** Where the server's time comes from (`RoomConnection.serverTime`). */
export const useServerClock = (next: () => number): void => {
	clock = next;
};
