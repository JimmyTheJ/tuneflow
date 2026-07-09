type Props = {
  visible: boolean;
  title: string;
  message?: string;
  onVerify: (pin: string) => Promise<boolean>;
  onSuccess: () => void;
  onCancel: () => void;
};

export function PinModal({ visible, title, message, onVerify, onSuccess, onCancel }: Props) {
  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const pin = String(form.get("pin") ?? "");
    const valid = await onVerify(pin);
    if (valid) onSuccess();
    else alert("Incorrect PIN");
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void handleSubmit(e)}>
        <h2>{title}</h2>
        {message ? <p className="muted">{message}</p> : null}
        <input name="pin" type="password" inputMode="numeric" placeholder="Parent PIN" className="input" autoFocus />
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}
