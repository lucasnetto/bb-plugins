import { expect, test } from "vite-plus/test";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

test("profile controls use the header slot and fit the host button size", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.experimentalSidebarNavigations).toHaveLength(0);

  const slot = renderSlot(
    app.experimentalSidebarHeaders[0]!,
    {
      width: 100,
      controlSize: 28,
      isCompactViewport: false,
    },
    {
      rpc: {
        info: () => ({
          current: "personal",
          profiles: [
            {
              id: "personal",
              name: "Personal",
              url: "https://personal.example.com",
              localUrl: null,
            },
            { id: "work", name: "Work", url: "https://work.example.com", localUrl: null },
          ],
        }),
      },
    },
  );

  try {
    const current = await slot.findByRole("link", { name: "Personal (current profile)" });
    expect(current.style.width).toBe("28px");
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(slot.getByRole("link", { name: "Work — switch profile" }).getAttribute("href")).toBe(
      "https://work.example.com/?bb-profile-resume=1",
    );
  } finally {
    slot.lifecycle.unmount();
  }
});

test("a narrow header leaves the footer selector available", async () => {
  const app = await loadPluginApp(() => import("../app"));

  const slot = renderSlot(app.experimentalSidebarHeaders[0]!, {
    width: 40,
    controlSize: 28,
    isCompactViewport: true,
  });

  try {
    expect(slot.queryByRole("group", { name: "Account profiles" })).toBeNull();
    expect(app.experimentalSidebarFooterItems).toHaveLength(1);
  } finally {
    slot.lifecycle.unmount();
  }
});
