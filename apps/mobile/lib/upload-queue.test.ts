import { mapWithConcurrency, withRetry } from "./upload-queue";

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once and keeps input order", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (delay, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running -= 1;
      return `item-${index}`;
    });

    expect(peak).toBe(2);
    expect(results).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });

  it("handles an empty list and rejects when a worker fails", async () => {
    await expect(mapWithConcurrency([], 2, async () => 1)).resolves.toEqual([]);
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("upload failed");
        return n;
      }),
    ).rejects.toThrow("upload failed");
  });
});

describe("withRetry", () => {
  it("retries a failure once and returns the later success", async () => {
    const attempt = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce("ok");
    await expect(withRetry(attempt)).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retries and skips errors that can't be fixed by retrying", async () => {
    const always = jest.fn().mockRejectedValue(new Error("network"));
    await expect(withRetry(always, { retries: 1 })).rejects.toThrow("network");
    expect(always).toHaveBeenCalledTimes(2);

    const tooBig = jest.fn().mockRejectedValue(new Error("too big"));
    await expect(withRetry(tooBig, { shouldRetry: () => false })).rejects.toThrow("too big");
    expect(tooBig).toHaveBeenCalledTimes(1);
  });
});
