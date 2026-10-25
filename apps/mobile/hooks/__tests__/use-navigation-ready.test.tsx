import { describe, expect, it, jest } from "@jest/globals";
import React from "react";
import { act, create } from "react-test-renderer";

import { useNavigationReady } from "../use-navigation-ready";

type Listener = () => void;

const mockNavigationRef = {
  ready: false,
  listeners: new Set<Listener>(),
  isReady() {
    return this.ready;
  },
  addListener(event: string, listener: Listener) {
    if (event === "ready") this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  becomeReady() {
    this.ready = true;
    this.listeners.forEach((listener) => listener());
  },
};

jest.mock("expo-router", () => ({
  useNavigationContainerRef: () => mockNavigationRef,
}));

function renderHook() {
  const seen: boolean[] = [];
  function Probe() {
    seen.push(useNavigationReady());
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });
  return { seen, renderer };
}

describe("useNavigationReady", () => {
  it("waits for the navigator, then reports ready and stops listening", () => {
    mockNavigationRef.ready = false;
    mockNavigationRef.listeners.clear();
    const { seen, renderer } = renderHook();

    expect(seen.at(-1)).toBe(false);
    expect(mockNavigationRef.listeners.size).toBe(1);

    act(() => mockNavigationRef.becomeReady());

    expect(seen.at(-1)).toBe(true);
    expect(mockNavigationRef.listeners.size).toBe(0);
    act(() => renderer.unmount());
  });

  it("is ready right away when the navigator already is", () => {
    mockNavigationRef.ready = true;
    mockNavigationRef.listeners.clear();
    const { seen, renderer } = renderHook();

    expect(seen).toEqual([true]);
    expect(mockNavigationRef.listeners.size).toBe(0);
    act(() => renderer.unmount());
  });
});
