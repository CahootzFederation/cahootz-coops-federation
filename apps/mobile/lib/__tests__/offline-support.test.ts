import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// The network the fetch wrapper in lib/api.ts sits on top of.
const network = jest.fn<typeof fetch>();
globalThis.fetch = network as unknown as typeof fetch;

/* eslint-disable @typescript-eslint/no-require-imports -- load after the fake network is in place */
const storageModule = require("@react-native-async-storage/async-storage");
const AsyncStorage = (storageModule.default ?? storageModule) as typeof import("@react-native-async-storage/async-storage").default;
const { API_BASE_URL, READ_TIMEOUT_MS, SAVED_RESPONSE_HEADER, createApiHeaders } = require("../api") as typeof import("../api");
const connectivity = require("../connectivity") as typeof import("../connectivity");
const offlineCache = require("../offline-cache") as typeof import("../offline-cache");
/* eslint-enable @typescript-eslint/no-require-imports */

const READ_URL = `${API_BASE_URL}/trpc/groups.listVisible?input=%7B%7D`;
const BODY = JSON.stringify({ result: { data: { circles: ["General"] } } });

function read(sessionToken = "token-a", url = READ_URL) {
  return fetch(url, { headers: createApiHeaders(null, sessionToken) });
}

function offline() {
  network.mockRejectedValue(new TypeError("Network request failed"));
}

/** Lets the wrapper's background save finish. */
async function flushSave() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await offlineCache.offlineCacheIdle();
}

beforeAll(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  network.mockReset();
  network.mockResolvedValue(new Response(BODY, { status: 200 }));
  connectivity.resetConnectivityForTests();
  await offlineCache.clearOfflineCache();
});

afterEach(() => {
  connectivity.resetConnectivityForTests();
});

describe("reads while offline", () => {
  it("shows the last saved answer and marks the app offline", async () => {
    await read();
    await flushSave();

    offline();
    const response = await read();

    expect(await response.text()).toBe(BODY);
    expect(response.headers.get(SAVED_RESPONSE_HEADER)).toBe("1");
    expect(connectivity.getConnectivity()).toEqual({ online: false, showingSaved: true });
  });

  it("never shows one account's saved data to another", async () => {
    await read("token-a");
    await flushSave();

    offline();
    await expect(read("token-b")).rejects.toThrow("Network request failed");
    expect(connectivity.getConnectivity()).toEqual({ online: false, showingSaved: false });
  });

  it("forgets everything saved on sign-out", async () => {
    await read();
    await flushSave();
    await offlineCache.clearOfflineCache();

    offline();
    await expect(read()).rejects.toThrow("Network request failed");
  });

  it("stops waiting on a read that hangs and shows the saved answer", async () => {
    await read();
    await flushSave();

    // A weak signal: the request never answers until it's cancelled.
    network.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    jest.useFakeTimers();
    try {
      const pending = read();
      await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
      const response = await pending;
      expect(await response.text()).toBe(BODY);
      expect(connectivity.getConnectivity()).toEqual({ online: false, showingSaved: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it("doesn't save failed answers", async () => {
    network.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await read();
    await flushSave();

    offline();
    await expect(read()).rejects.toThrow("Network request failed");
  });

  it("only saves reads on the saved list: never money, messages or the live street", async () => {
    const neverSaved = ["user.getBalances", "commerce.listTransactions", "groups.listDirectMessages", "sage.list", "user.getMe", "street.get"];
    for (const procedure of neverSaved) {
      await read("token-a", `${API_BASE_URL}/trpc/${procedure}?input=%7B%7D`);
    }
    await flushSave();
    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("cahootz.offline."))).toEqual([]);

    offline();
    for (const procedure of neverSaved) {
      await expect(read("token-a", `${API_BASE_URL}/trpc/${procedure}?input=%7B%7D`)).rejects.toThrow("Network request failed");
    }
    expect(connectivity.getConnectivity()).toEqual({ online: false, showingSaved: false });
  });

  it("keeps each Commons' saved answers apart, even for the same address", async () => {
    const inCommons = (coopId: string) =>
      fetch(READ_URL, { headers: { ...(createApiHeaders(null, "token-a") as Record<string, string>), "x-coop-id": coopId } });
    await inCommons("commons-a");
    await flushSave();

    offline();
    expect(await (await inCommons("commons-a")).text()).toBe(BODY);
    await expect(inCommons("commons-b")).rejects.toThrow("Network request failed");
  });

  it("names saved entries with a full SHA-256, never the session token", () => {
    const key = offlineCache.offlineCacheKey(READ_URL, "secret-token|0xabc", "commons-a");
    expect(key).toMatch(/^cahootz\.offline\.[0-9a-f]{64}$/);
    expect(key).not.toContain("secret-token");
    expect(offlineCache.offlineCacheKey(READ_URL, "secret-token|0xabc", "commons-b")).not.toBe(key);
  });

  it("stops showing saved answers once they're a week old", async () => {
    await read();
    await flushSave();
    const key = offlineCache.offlineCacheKey(READ_URL, "token-a|");
    expect(await offlineCache.readOfflineResponse(key)).toBe(BODY);
    expect(await offlineCache.readOfflineResponse(key, Date.now() + offlineCache.MAX_AGE_MS + 1)).toBeNull();
  });

  it("forgets a saved answer when the server says it isn't yours anymore", async () => {
    await read();
    await flushSave();

    network.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    await read();
    await flushSave();

    offline();
    await expect(read()).rejects.toThrow("Network request failed");
  });
});

describe("signing out", () => {
  it("drops a save that was still on its way when sign-out started", async () => {
    let answer: (response: Response) => void = () => {};
    network.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    const pending = read();

    // Sign out while the read is still waiting on the server.
    const cleared = offlineCache.clearOfflineCache();
    answer(new Response(BODY, { status: 200 }));
    await pending;
    await cleared;
    await flushSave();

    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("cahootz.offline."))).toEqual([]);
  });

  it("drops saves already queued when sign-out starts", async () => {
    const key = offlineCache.offlineCacheKey(READ_URL, "token-a|");
    const saving = offlineCache.saveOfflineResponse(key, BODY);
    const cleared = offlineCache.clearOfflineCache();
    await Promise.all([saving, cleared]);

    expect(await offlineCache.readOfflineResponse(key)).toBeNull();
  });

  it("removes saved entries even when the index lost track of them", async () => {
    await AsyncStorage.setItem("cahootz.offline.orphan", "{}");
    await AsyncStorage.setItem("someone.else", "keep");
    await offlineCache.clearOfflineCache();

    expect(await AsyncStorage.getItem("cahootz.offline.orphan")).toBeNull();
    expect(await AsyncStorage.getItem("someone.else")).toBe("keep");
  });
});

describe("changes and cancellations", () => {
  it("never saves or replays a request that sends data", async () => {
    const send = () =>
      fetch(`${API_BASE_URL}/trpc/commons.createPost`, {
        method: "POST",
        headers: createApiHeaders(null, "token-a"),
        body: "{}",
      });
    await send();
    await flushSave();

    offline();
    await expect(send()).rejects.toThrow("Network request failed");
    expect(connectivity.getConnectivity().online).toBe(false);
  });

  it("treats a request the screen cancelled as a cancellation, not an outage", async () => {
    const controller = new AbortController();
    network.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(
      fetch(READ_URL, { headers: createApiHeaders(null, "token-a"), signal: controller.signal }),
    ).rejects.toThrow("Aborted");
    expect(connectivity.getConnectivity().online).toBe(true);
  });
});

describe("coming back online", () => {
  it("clears the offline state and tells screens to refresh", async () => {
    const refreshed = jest.fn();
    const stop = connectivity.onReconnect(refreshed);

    offline();
    await expect(read()).rejects.toThrow();
    expect(connectivity.getConnectivity().online).toBe(false);

    network.mockResolvedValue(new Response(BODY, { status: 200 }));
    await read();

    expect(connectivity.getConnectivity()).toEqual({ online: true, showingSaved: false });
    expect(refreshed).toHaveBeenCalledTimes(1);
    stop();
  });

  it("notices the connection is back from the health check", async () => {
    offline();
    await expect(read()).rejects.toThrow();

    network.mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(connectivity.checkConnection(network as unknown as typeof fetch)).resolves.toBe(true);
    expect(network).toHaveBeenLastCalledWith(`${API_BASE_URL}/health`, expect.anything());
    expect(connectivity.getConnectivity().online).toBe(true);
  });
});

describe("saved data limits", () => {
  it("skips answers too big to keep", async () => {
    network.mockResolvedValueOnce(new Response("x".repeat(offlineCache.MAX_BODY_CHARS + 1), { status: 200 }));
    await read();
    await flushSave();

    offline();
    await expect(read()).rejects.toThrow("Network request failed");
  });

  it("keeps only the most recent reads", async () => {
    for (let i = 0; i <= offlineCache.MAX_ENTRIES; i++) {
      network.mockResolvedValueOnce(new Response(`{"n":${i}}`, { status: 200 }));
      await read("token-a", `${READ_URL}&n=${i}`);
      await flushSave();
    }

    offline();
    await expect(read("token-a", `${READ_URL}&n=0`)).rejects.toThrow("Network request failed");
    const newest = await read("token-a", `${READ_URL}&n=${offlineCache.MAX_ENTRIES}`);
    expect(await newest.text()).toBe(`{"n":${offlineCache.MAX_ENTRIES}}`);
  });
});
