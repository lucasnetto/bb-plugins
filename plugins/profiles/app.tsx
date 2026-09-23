import { useEffect, useState } from "react";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRpc,
  useSettings,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import type { ProfileInfo, rpcContract } from "./contract.ts";
import { LAST_THREAD_KEY, profileSwitchUrl, resumeThread, savedThreadPath } from "./navigation.ts";
import "./app.css";

function ProfileOptions({ compact = false }: { compact?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void rpc
      .call("info", null)
      .then((value) => {
        if (!disposed) setInfo(value);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });

    return () => {
      disposed = true;
    };
  }, [rpc, values]);

  if (error)
    return (
      <p role="alert" className="bb-profiles-error">
        Profiles are unavailable. Reload to retry.
      </p>
    );

  if (!info) return <p className="bb-profiles-loading">Loading profiles…</p>;

  const available = info.profiles.filter((profile) =>
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname)
      ? profile.localUrl || profile.url
      : profile.url,
  );

  if (!available.length)
    return (
      <p className="bb-profiles-note">Configure account addresses on the Profiles plugin page.</p>
    );

  if (compact)
    return (
      <div className="bb-profiles-strip" role="group" aria-label="Account profiles">
        {available.map((profile) => (
          <a
            key={profile.id}
            className="bb-profiles-icon"
            href={profileSwitchUrl(profile.url, profile.localUrl, window.location.hostname)}
            aria-label={`${profile.name}${profile.id === info.current ? " (current profile)" : " — switch profile"}`}
            title={profile.name}
            aria-current={profile.id === info.current ? "true" : undefined}
            onClick={(event) => {
              if (profile.id === info.current) event.preventDefault();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {profile.id === "personal" ? (
                <>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
                </>
              ) : (
                <>
                  <rect x="3" y="7" width="18" height="14" rx="2" />
                  <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a20 20 0 0 0 18 0M12 12v3" />
                </>
              )}
            </svg>
          </a>
        ))}
      </div>
    );

  return (
    <div className="bb-profiles-menu" aria-label="Account profiles">
      <p className="bb-profiles-heading">Profile</p>
      {available.map((profile) => (
        <a
          key={profile.id}
          className="bb-profiles-option"
          href={profileSwitchUrl(profile.url, profile.localUrl, window.location.hostname)}
          aria-current={profile.id === info.current ? "true" : undefined}
          onClick={(event) => {
            if (profile.id === info.current) event.preventDefault();
          }}
        >
          <span className={`bb-profiles-dot bb-profiles-dot-${profile.id}`} />
          <span className="bb-profiles-copy">
            <strong>{profile.name}</strong>
            <span>{profile.email}</span>
          </span>
          {profile.id === info.current && (
            <span className="bb-profiles-check" aria-label="Current profile">
              ✓
            </span>
          )}
        </a>
      ))}
      <p className="bb-profiles-note">Threads keep running when you switch.</p>
    </div>
  );
}

function ProfileSelector() {
  return <ProfileOptions />;
}

function RememberThread() {
  const { projectId, threadId } = useBbContext();
  const navigate = useBbNavigate();
  useEffect(() => {
    resumeThread(window, (id) => navigate.toThread(id));
  }, [navigate]);
  useEffect(() => {
    if (!projectId || !threadId) return;
    const path = savedThreadPath(`/projects/${projectId}/threads/${threadId}`);

    if (!path) return;

    try {
      window.localStorage.setItem(LAST_THREAD_KEY, path);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [projectId, threadId]);

  return null;
}

function ProfileNavigation({
  experimental_Original: Original,
}: ExperimentalSidebarNavigationProps) {
  return (
    <>
      <ProfileOptions compact />
      <Original />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "remember-thread", component: RememberThread });
  app.slots.experimental_sidebarNavigation({
    id: "profiles",
    title: "Profiles",
    description: "Profile icons above the standard navigation.",
    component: ProfileNavigation,
  });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "profiles",
    label: "Switch profile",
    icon: "Users",
    component: ProfileSelector,
  });
  app.slots.homepageSection({
    id: "profiles",
    title: "Account profile",
    component: ProfileSelector,
  });
  app.slots.settingsSection({
    id: "profiles",
    title: "Account profiles",
    component: ProfileSelector,
  });
});
