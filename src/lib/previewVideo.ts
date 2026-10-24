const preview = document.createElement('video');
preview.autoplay = true;
preview.muted = true;
preview.playsInline = true;
preview.setAttribute('playsinline', '');

function park() {
  let holder = document.getElementById('LetsConnect-preview-park');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'LetsConnect-preview-park';
    holder.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';
    document.body.appendChild(holder);
  }
  holder.appendChild(preview);
}

export function getPreviewVideo() {
  return preview;
}

export function mountPreview(
  parent: HTMLElement,
  stream: MediaStream | null,
  options: {
    mirror: boolean;
    recordName?: string;
    recordOff?: boolean;
    conceal?: boolean;
    recordPeer?: string;
    recordRole?: string;
    recordColor?: string;
    recordInitials?: string;
  },
) {
  preview.className = ['fit-contain', options.mirror ? 'mirror' : '', options.recordOff ? 'is-off' : '', options.conceal ? 'fx-hidden' : '']
    .filter(Boolean)
    .join(' ');
  preview.dataset.recVideo = '1';
  preview.dataset.recKind = 'camera';
  preview.dataset.recName = options.recordName || '';
  preview.dataset.recOff = options.recordOff ? '1' : '0';
  preview.dataset.recPeer = options.recordPeer || '';
  preview.dataset.recRole = options.recordRole || '';
  preview.dataset.recColor = options.recordColor || '';
  preview.dataset.recInitials = options.recordInitials || '';
  if (preview.srcObject !== stream) preview.srcObject = stream;
  parent.appendChild(preview);
  void preview.play().catch(() => undefined);
  return () => {
    if (preview.parentElement === parent) park();
  };
}
