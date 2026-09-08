import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { ProfileInfo, rpcContract } from "./contract.ts";
import { destinationUrl } from "./navigation.ts";
import "./app.css";

function ProfileSelector() {
  const rpc = useRpc<typeof rpcContract>();
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void rpc.call("info", null).then(value => {
      if (!disposed) setInfo(value);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [rpc]);
  if (error) return <p role="alert" className="bb-profiles-error">Profiles are unavailable. Reload to retry.</p>;
  if (!info) return <p className="bb-profiles-loading">Loading profiles…</p>;
  return <div className="bb-profiles-menu" aria-label="Account profiles">
    <p className="bb-profiles-heading">Profile</p>
    {info.profiles.map(profile => <a
      key={profile.id}
      className="bb-profiles-option"
      href={destinationUrl(profile.url, profile.localUrl, window.location.hostname)}
      aria-current={profile.id === info.current ? "true" : undefined}
      onClick={event => { if (profile.id === info.current) event.preventDefault(); }}
    >
      <span className={`bb-profiles-dot bb-profiles-dot-${profile.id}`} />
      <span className="bb-profiles-copy"><strong>{profile.name}</strong><span>{profile.email}</span></span>
      {profile.id === info.current && <span className="bb-profiles-check" aria-label="Current profile">✓</span>}
    </a>)}
    <p className="bb-profiles-note">Threads keep running when you switch.</p>
  </div>;
}

export default definePluginApp(app => {
  app.experimental_sidebarFooter.register({
    kind: "disclosure", id: "profiles", label: "Switch profile", icon: "Users", component: ProfileSelector,
  });
  app.slots.homepageSection({ id: "profiles", title: "Account profile", component: ProfileSelector });
  app.slots.settingsSection({ id: "profiles", title: "Account profiles", component: ProfileSelector });
});
