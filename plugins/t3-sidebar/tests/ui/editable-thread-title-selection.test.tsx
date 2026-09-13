// @vitest-environment jsdom
import { StrictMode } from "react";
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, render } from "@testing-library/react";
import {
  EditableThreadTitle,
  useThreadRename,
} from "../../src/ui/components/sidebar/EditableThreadTitle";

function RenameHarness({ onRename }: { onRename: (title: string) => void }) {
  const rename = useThreadRename("Original title", onRename);

  return (
    <>
      <button onClick={rename.start}>Rename</button>
      <EditableThreadTitle
        rename={rename}
        title="Original title"
        recede={false}
        isCard={false}
        isActive={false}
        isUnread={false}
      />
    </>
  );
}

// jsdom does not perform keyboard default actions. Insert each character at
// the current selection so unwanted reselection affects subsequent typing.
function typeText(input: HTMLInputElement, text: string) {
  for (const character of text) {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    fireEvent.input(input, {
      target: {
        value: input.value.slice(0, start) + character + input.value.slice(end),
        selectionStart: start + 1,
        selectionEnd: start + 1,
      },
    });
  }
}

test.each(["Enter", "blur"])("typing preserves the caret and commits on %s", (commit) => {
  const onRename = vi.fn();

  const view = render(
    <StrictMode>
      <RenameHarness onRename={onRename} />
    </StrictMode>,
  );

  try {
    fireEvent.click(view.getByRole("button", { name: "Rename" }));
    const input = view.getByRole("textbox");

    if (!(input instanceof HTMLInputElement)) throw new Error("Expected title input");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    typeText(input, "New title");
    expect(input.value).toBe("New title");
    expect(input.selectionStart).toBe(input.value.length);
    input.setSelectionRange(4, 4);
    typeText(input, "thread ");
    expect(input.value).toBe("New thread title");

    if (commit === "blur") fireEvent.blur(input);
    else fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("New thread title");
    expect(view.queryByRole("textbox")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Rename" }));
    const reopened = view.getByRole("textbox");

    if (!(reopened instanceof HTMLInputElement)) throw new Error("Expected reopened title input");
    expect(document.activeElement).toBe(reopened);
    expect(reopened.selectionStart).toBe(0);
    expect(reopened.selectionEnd).toBe(reopened.value.length);
    typeText(reopened, "Discard this");
    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(view.queryByRole("textbox")).toBeNull();
    expect(onRename).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});
