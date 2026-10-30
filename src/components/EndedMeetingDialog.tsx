type Props = {
  onClose: () => void;
};

export function EndedMeetingDialog({ onClose }: Props) {
  return (
    <div className="modal-back leave-modal-back ended-meeting-back" role="presentation" onClick={onClose}>
      <div
        className="leave-dialog ended-meeting-dialog"
        role="alertdialog"
        aria-labelledby="ended-meeting-title"
        aria-describedby="ended-meeting-copy"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="leave-dialog-copy">
          <strong id="ended-meeting-title">That meeting is ended</strong>
          <p id="ended-meeting-copy">The host ended this meeting for everyone.</p>
        </div>
        <div className="leave-dialog-actions ended-meeting-actions">
          <button type="button" className="primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
