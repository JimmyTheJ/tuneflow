import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <form
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-elevated p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h2 className="m-0 text-xl font-bold tracking-tight">{title}</h2>
        {message ? <p className="m-0 text-sm text-text-secondary">{message}</p> : null}
        <Input name="pin" type="password" inputMode="numeric" placeholder="Parent PIN" autoFocus />
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1">
            Confirm
          </Button>
        </div>
      </form>
    </div>
  );
}
