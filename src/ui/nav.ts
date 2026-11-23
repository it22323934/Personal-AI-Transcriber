/** Opens (or focuses) the full-page library, optionally at a route like "/note/<id>". */
export async function openLibrary(route = ''): Promise<void> {
  const base = chrome.runtime.getURL('library.html');
  const url = route ? `${base}#${route}` : base;
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url?.startsWith(base));
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, ...(route ? { url } : {}) });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}
