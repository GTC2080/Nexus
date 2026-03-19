import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotePersistence } from "./useNotePersistence";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("useNotePersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("returns enqueueSave and flushPendingSave", () => {
    const { result } = renderHook(() =>
      useNotePersistence({ onError: vi.fn() }),
    );

    expect(typeof result.current.enqueueSave).toBe("function");
    expect(typeof result.current.flushPendingSave).toBe("function");
  });

  it("calls invoke write_note when enqueueSave is called", async () => {
    const { result } = renderHook(() =>
      useNotePersistence({ onError: vi.fn() }),
    );

    await act(async () => {
      result.current.enqueueSave("/vault", "/vault/note.md", "# Hello");
      // Let microtasks (the async processQueue) resolve
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalled();
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith("write_note", {
      vaultPath: "/vault",
      filePath: "/vault/note.md",
      content: "# Hello",
    });
  });

  it("deduplicates saves with identical content (same fingerprint)", async () => {
    const { result } = renderHook(() =>
      useNotePersistence({ onError: vi.fn() }),
    );

    await act(async () => {
      result.current.enqueueSave("/vault", "/vault/note.md", "same content");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledTimes(1);
      });
    });

    // Enqueue the same content again
    await act(async () => {
      result.current.enqueueSave("/vault", "/vault/note.md", "same content");
      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 10));
    });

    // Should still be only 1 call because fingerprint matches
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("saves when content changes (different fingerprint)", async () => {
    const { result } = renderHook(() =>
      useNotePersistence({ onError: vi.fn() }),
    );

    await act(async () => {
      result.current.enqueueSave("/vault", "/vault/note.md", "version 1");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledTimes(1);
      });
    });

    await act(async () => {
      result.current.enqueueSave("/vault", "/vault/note.md", "version 2");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledTimes(2);
      });
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("does nothing for empty vaultPath or filePath", async () => {
    const { result } = renderHook(() =>
      useNotePersistence({ onError: vi.fn() }),
    );

    await act(async () => {
      result.current.enqueueSave("", "/vault/note.md", "content");
      result.current.enqueueSave("/vault", "", "content");
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("calls onError when invoke fails", async () => {
    const onError = vi.fn();
    mockInvoke.mockRejectedValueOnce(new Error("write failed"));

    const { result } = renderHook(() =>
      useNotePersistence({ onError }),
    );

    await act(async () => {
      result.current.enqueueSave("/vault", "/vault/note.md", "content");
      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("保存失败"),
    );
  });

  it("coalesces rapid saves - only the last content is written", async () => {
    // Make invoke slow so we can queue multiple saves
    let resolveInvoke: (() => void) | null = null;
    mockInvoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInvoke = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useNotePersistence({ onError: vi.fn() }),
    );

    await act(async () => {
      // Queue first save (will start processing immediately)
      result.current.enqueueSave("/vault", "/vault/note.md", "first");
      // Give the microtask a tick to start processing
      await new Promise((r) => setTimeout(r, 0));
    });

    // Now while the first save is in-flight, enqueue more
    act(() => {
      result.current.enqueueSave("/vault", "/vault/note.md", "second");
      result.current.enqueueSave("/vault", "/vault/note.md", "third");
    });

    // Resolve the first write
    await act(async () => {
      resolveInvoke!();
      await new Promise((r) => setTimeout(r, 0));
    });

    // The queue should now process "third" (second was overwritten by third in pending)
    // Resolve the second write
    await act(async () => {
      if (resolveInvoke) resolveInvoke();
      await new Promise((r) => setTimeout(r, 0));
    });

    // Check that write_note was called, and the last call had "third" as content
    const writeCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "write_note",
    );
    expect(writeCalls.length).toBeGreaterThanOrEqual(1);
    const lastWriteCall = writeCalls[writeCalls.length - 1];
    expect((lastWriteCall[1] as Record<string, string>).content).toBe("third");
  });
});
