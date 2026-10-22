// Bridge for the shell's own pages (the connection screen). The Legal Assistant web app
// itself gets no privileged APIs — it must behave identically in a browser —
// with one deliberate exception: guestCredentials, which the login page uses
// to offer "Continue as guest" in local mode. It is read-only and gated
// main-side to local mode + the local frontend's origin.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("legalAssistantDesktop", {
  getServerUrl: () => ipcRenderer.invoke("legalAssistant:get-server-url"),
  setServerUrl: (url) => ipcRenderer.invoke("legalAssistant:set-server-url", url),
  retry: () => ipcRenderer.invoke("legalAssistant:retry"),
  // Local mode (self-contained stack). startLocal is gated main-side to the
  // shell's own pages; localAvailable and onLocalStatus are read-only.
  localAvailable: () => ipcRenderer.invoke("legalAssistant:local-available"),
  startLocal: () => ipcRenderer.invoke("legalAssistant:start-local"),
  chooseCloud: () => ipcRenderer.invoke("legalAssistant:choose-cloud"),
  guestCredentials: () => ipcRenderer.invoke("legalAssistant:guest-credentials"),
  openConnect: () => ipcRenderer.invoke("legalAssistant:open-connect"),
  onLocalStatus: (cb) =>
    ipcRenderer.on("legalAssistant:local-status", (_event, msg) => cb(String(msg))),
});
