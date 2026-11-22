import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  variant?: 'cyber' | 'classic';
}

export function ModalDialog({
  open,
  title,
  onClose,
  children,
  maxWidthClass = 'max-w-lg',
  variant = 'cyber',
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  if (variant === 'classic') {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        {...({ closedby: 'any' } as any)}
        className={`classicPopupDialog m-auto w-[92vw] ${maxWidthClass}`}
      >
        <div className="window classicPopupWindow">
          <div className="wtitle">
            <img
              className="wbutton"
              src="/img/design/pixel.gif"
              alt="Fermer"
              onClick={() => dialogRef.current?.close()}
            />
            <span id={titleId}>{title}</span>
          </div>
          <div className="container">{children}</div>
        </div>
      </dialog>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
      className={`m-auto w-[92vw] ${maxWidthClass} rounded-md border border-[#5f6f41] bg-[#141a0f] p-0 text-[#e1e8c5] shadow-2xl`}
    >
      <div className="flex items-center justify-between border-b border-[#343f24] bg-[#1e2616] px-4 py-2.5">
        <h2 id={titleId} className="font-mono text-sm font-bold tracking-wider text-[#fed82a] uppercase">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close modal"
          className="rounded p-1 text-[#9aa678] hover:bg-[#2c3720] hover:text-[#fed82a]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
