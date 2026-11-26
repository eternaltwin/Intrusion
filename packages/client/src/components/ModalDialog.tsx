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

    // Fallback for browsers without declarative <dialog closedby="any"> support (e.g. Safari)
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = dialog.open && e.target === dialog && isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (dialog.open && pressedOutside && e.target === dialog && isOutside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      return () => {
        dialog.removeEventListener('close', handleClose);
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

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
            <button
              type="button"
              className="wbutton"
              aria-label="Fermer"
              onClick={() => dialogRef.current?.close()}
            />
            <h1 id={titleId} className="classicPopupHeading">
              {title}
            </h1>
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
