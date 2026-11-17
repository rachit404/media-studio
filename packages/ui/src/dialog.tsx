import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

export interface DialogProps {
  title: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  children: ReactNode;
  /** When false the dialog can only be closed by its own buttons (for decisions the user must make). Default true. */
  dismissable?: boolean;
  role?: 'dialog' | 'alertdialog';
}

/** Modal dialog with focus trap, Escape to close and labelled heading (from React Aria). */
export function Dialog({
  title,
  isOpen,
  onOpenChange,
  children,
  dismissable = true,
  role = 'dialog',
}: DialogProps) {
  return (
    <ModalOverlay
      isDismissable={dismissable}
      isKeyboardDismissDisabled={!dismissable}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-surface-sunken/80 p-4"
    >
      <Modal className="max-h-full w-full max-w-2xl overflow-auto rounded-lg border border-line bg-surface-raised text-fg shadow-panel">
        <AriaDialog role={role} className="p-6 outline-none">
          <Heading slot="title" className="mb-4 text-lg font-semibold">
            {title}
          </Heading>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
