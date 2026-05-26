import type { TFunction } from "i18next"

type DeleteSessionDialogProps = {
  deleteError: string
  deletePending: boolean
  target: { id: string; title: string }
  onCancel: () => void
  onConfirm: () => Promise<void>
  t: TFunction
}

export function DeleteSessionDialog({ deleteError, deletePending, onCancel, onConfirm, target, t }: DeleteSessionDialogProps) {
  return (
    <div className="wa-delete-dialog-backdrop" role="presentation" onClick={() => !deletePending && onCancel()}>
      <section
        aria-labelledby="wa-delete-dialog-title"
        aria-modal="true"
        className="wa-delete-dialog"
        role="dialog"
        onClick={event => event.stopPropagation()}
      >
        <div className="wa-delete-dialog-body">
          <div className="wa-delete-dialog-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5h6" />
              <path d="M10 5l1-2h2l1 2" />
              <path d="M5 7h14" />
              <path d="M7 7l1 14h8l1-14" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </div>
          <h3 id="wa-delete-dialog-title">{t("home.deleteDialogTitle")}</h3>
          <p>{t("home.deleteDialogDescription", { title: target.title })}</p>
          {deleteError && <span className="wa-delete-dialog-error">{deleteError}</span>}
        </div>
        <div className="wa-delete-dialog-actions">
          <button type="button" className="wa-delete-dialog-cancel" disabled={deletePending} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="wa-delete-dialog-danger"
            disabled={deletePending}
            onClick={onConfirm}
          >
            {deletePending ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </section>
    </div>
  )
}
