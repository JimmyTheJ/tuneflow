import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PinModal } from "@/components/PinModal";
import { api } from "@/lib/api";
import { getApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/authStore";
import type { ParentalSettings } from "@/types";

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const isChild = user?.role === "child";
  const isParent = user?.role === "parent";

  const [apiUrl, setApiUrlState] = useState(getApiUrl());
  const [parentPin, setParentPin] = useState("");
  const [hasParentPin, setHasParentPin] = useState(false);
  const [childSettings, setChildSettings] = useState<ParentalSettings | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isParent) void api.parentPinStatus().then((s) => setHasParentPin(s.has_pin)).catch(() => undefined);
    if (isChild) void api.getMyChildSettings().then(setChildSettings).catch(() => undefined);
  }, [isChild, isParent]);

  const protectedAction = async (action: "logout" | "switch") => {
    if (!isChild) {
      logout();
      if (action === "switch") navigate("/login");
      return;
    }
    try {
      const { enforced } = await api.parentPinEnforced();
      if (!enforced) {
        logout();
        navigate("/login");
        return;
      }
    } catch {
      /* fall through */
    }
    setPinOpen(true);
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      {user ? (
        <div className="card">
          <p className="label">Signed in as</p>
          <p className="track-title">
            {user.display_name} ({user.role})
          </p>
        </div>
      ) : null}

      {isChild && childSettings ? (
        <div className="card">
          <p className="label">Your limits</p>
          <p className="muted">
            {childSettings.max_daily_minutes != null
              ? `${childSettings.max_daily_minutes} min/day`
              : "No daily limit"}
            {" · "}
            {childSettings.search_enabled ? "Search on" : "Search off"}
          </p>
        </div>
      ) : null}

      <button type="button" className="btn-secondary btn-block" onClick={() => void protectedAction("switch")}>
        Switch account
      </button>
      <button type="button" className="btn-secondary btn-block" onClick={() => void protectedAction("logout")}>
        Sign out
      </button>

      {isParent ? (
        <>
          <Link to="/family" className="btn-secondary btn-block link-btn">
            Family members
          </Link>
          <Link to="/parental" className="btn-secondary btn-block link-btn">
            Parental controls
          </Link>
          <h2>Parent PIN</h2>
          <p className="muted">
            Required for children to switch accounts on a shared device.
            {hasParentPin ? " PIN is set." : " No PIN set yet."}
          </p>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="4+ digit PIN"
            value={parentPin}
            onChange={(e) => setParentPin(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary btn-block"
            onClick={() =>
              void api.setParentPin(parentPin).then(() => {
                setHasParentPin(true);
                setParentPin("");
                setMessage("Parent PIN saved");
              })
            }
          >
            {hasParentPin ? "Update parent PIN" : "Set parent PIN"}
          </button>
        </>
      ) : null}

      {!isChild ? (
        <>
          <h2>Server</h2>
          <p className="muted">API URL for this browser app (default: localhost:8010)</p>
          <input className="input" value={apiUrl} onChange={(e) => setApiUrlState(e.target.value)} />
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              setApiUrl(apiUrl);
              setMessage("Server URL saved");
            }}
          >
            Save server URL
          </button>
        </>
      ) : null}

      {message ? <p className="accent">{message}</p> : null}

      <PinModal
        visible={pinOpen}
        title="Parent PIN required"
        message="Enter a parent PIN to continue."
        onVerify={async (pin) => (await api.verifyParentPin(pin)).valid}
        onSuccess={() => {
          setPinOpen(false);
          logout();
          navigate("/login");
        }}
        onCancel={() => setPinOpen(false)}
      />
    </div>
  );
}
