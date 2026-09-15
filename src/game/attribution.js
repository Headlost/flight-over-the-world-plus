// Provider HTML is untrusted. Preserve text and HTTPS links without executing markup.
export function attributionSignature(entries = []) {
  return entries
    .map((entry) => `${String(entry?.type || '')}:${String(entry?.value || '')}`)
    .sort()
    .join('\u001f');
}

export function renderAttributions(container, entries) {
  container.replaceChildren();
  function append(parent, node) {
    if (node.nodeType === 3) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1 || ['SCRIPT','STYLE','IFRAME','OBJECT'].includes(node.tagName)) return;
    let target = parent;
    if (node.tagName === 'A' && /^https:\/\//i.test(node.getAttribute('href') || '')) {
      target = document.createElement('a'); target.href = node.getAttribute('href'); target.target = '_blank'; target.rel = 'noopener noreferrer'; parent.append(target);
    }
    for (const child of node.childNodes) append(target, child);
  }
  for (const entry of entries) {
    const span = document.createElement('span');
    if (entry.type === 'html') {
      const doc = new DOMParser().parseFromString(String(entry.value), 'text/html');
      for (const child of doc.body.childNodes) append(span, child);
    } else if (entry.type === 'image' && /^(https:\/\/|data:image\/png;base64,)/i.test(entry.value)) {
      const img = document.createElement('img'); img.src = entry.value; img.alt = 'Map data provider'; span.append(img);
    } else if (entry.type === 'string') span.textContent = entry.value;
    container.append(span);
  }
  const osm = document.createElement('a'); osm.href = 'https://www.openstreetmap.org/copyright'; osm.target = '_blank'; osm.rel = 'noopener noreferrer'; osm.textContent = 'Search: Photon / © OpenStreetMap'; container.append(osm);
}
