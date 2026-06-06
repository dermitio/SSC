const log = document.getElementById("log");
const input = document.getElementById("msg");
const composer = document.getElementById("composer");
const recordBtn = document.getElementById("record");
const attachBtn = document.getElementById("attach");
const sendBtn = document.getElementById("sendBtn");
const renameBtn = document.getElementById("rename");
const fileInput = document.getElementById("fileInput");
const favicon = document.getElementById("favicon");
const currentName = document.getElementById("currentName");
const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const recPopup = document.getElementById("recPopup");
const recTimeEl = document.getElementById("recTime");
const recStopBtn = document.getElementById("recStop");
const chatShell = document.getElementById("chatShell");
const participantsEl = document.getElementById("participants");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarPanel = document.getElementById("sidebarPanel");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const audioCallBtn = document.getElementById("audioCall");
const videoCallBtn = document.getElementById("videoCall");
const callPanel = document.getElementById("callPanel");
const callStatus = document.getElementById("callStatus");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const callEmpty = document.getElementById("callEmpty");
const toggleMicBtn = document.getElementById("toggleMic");
const toggleCameraBtn = document.getElementById("toggleCamera");
const hangupBtn = document.getElementById("hangup");
const incomingCall = document.getElementById("incomingCall");
const incomingTitle = document.getElementById("incomingTitle");
const incomingCopy = document.getElementById("incomingCopy");
const acceptCallBtn = document.getElementById("acceptCall");
const declineCallBtn = document.getElementById("declineCall");

let loadingHistory = true;
let unreadCount = 0;
let recorder = null;
let audioChunks = [];
let audioStream = null;
let recStartTs = 0;
let recTimer = null;

const originalTitle = document.title;
let name = getStoredName();
let ws = null;
let rtcConfigPromise = null;
let clientId = null;
let participants = [];
let selectedPeerId = null;
let activePeerId = null;
let activePeerName = "";
let activeCallKind = "audio";
let pendingOffer = null;
let peer = null;
let localStream = null;
let remoteStream = null;
let pendingIceCandidates = [];
let pendingIceCandidateKeys = new Set();
let disconnectTimer = null;
let endingCall = false;
let localRelayCandidateCount = 0;
let lastIceCandidateError = null;

setName(name);
requestNotificationPermission();
connect();
installRtcHelpers();

window.addEventListener("focus", clearUnread);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") clearUnread();
});

composer.addEventListener("submit", event => {
  event.preventDefault();
  send();
});

renameBtn.addEventListener("click", () => {
  const next = prompt("Your name?", name);
  if (!next) return;
  setName(next);
});

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", uploadSelectedFile);

recordBtn.addEventListener("pointerdown", event => {
  event.preventDefault();
  startRecording();
});
recordBtn.addEventListener("pointerup", stopRecording);
recordBtn.addEventListener("pointerleave", stopRecording);
recordBtn.addEventListener("pointercancel", stopRecording);
recStopBtn.addEventListener("click", stopRecording);
sidebarToggle.addEventListener("click", () => {
  setSidebarOpen(!sidebarPanel.classList.contains("is-open"));
});
sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") setSidebarOpen(false);
});
audioCallBtn.addEventListener("click", () => startCall("audio"));
videoCallBtn.addEventListener("click", () => startCall("video"));
toggleMicBtn.addEventListener("click", toggleMic);
toggleCameraBtn.addEventListener("click", toggleCamera);
hangupBtn.addEventListener("click", () => endCall(true));
acceptCallBtn.addEventListener("click", acceptIncomingCall);
declineCallBtn.addEventListener("click", declineIncomingCall);

function getStoredName() {
  const stored = localStorage.getItem("name");
  if (stored?.trim()) return stored.trim();

  const prompted = prompt("Your name?");
  return prompted?.trim() || "Guest";
}

function setName(nextName) {
  name = nextName.trim() || "Guest";
  localStorage.setItem("name", name);
  currentName.textContent = name;
  sendPresence();
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function installRtcHelpers() {
  window.SSC = {
    getTurnConfig,
    createPeerConnection
  };
}

async function getTurnConfig() {
  rtcConfigPromise ??= fetch("/turn-credentials", {
    cache: "no-store"
  }).then(async res => {
    if (!res.ok) {
      throw new Error(`TURN config failed: ${res.status}`);
    }

    return res.json();
  });

  return rtcConfigPromise;
}

async function createPeerConnection(overrides = {}) {
  const config = await getTurnConfig();
  return new RTCPeerConnection({
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    ...config,
    ...overrides,
    iceServers: overrides.iceServers || config.iceServers
  });
}

function connect() {
  setConnectionState("connecting");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.addEventListener("open", () => setConnectionState("online"));
  ws.addEventListener("close", () => {
    setConnectionState("offline");
    renderSystem("Connection lost. Refresh when the server is back.");
  });
  ws.addEventListener("error", () => setConnectionState("offline"));
  ws.addEventListener("message", event => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.system && Array.isArray(data.history)) {
      data.history.forEach(render);
      loadingHistory = false;
      return;
    }

    if (handleAppMessage(data)) return;

    render(data);
  });
}

function handleAppMessage(data) {
  if (data.type === "client-ready") {
    clientId = data.clientId;
    sendPresence();
    renderParticipants();
    return true;
  }

  if (data.type === "presence") {
    participants = Array.isArray(data.participants) ? data.participants : [];
    if (!participants.some(participant => participant.id === selectedPeerId)) {
      selectedPeerId = participants.find(participant => participant.id !== clientId)?.id || null;
    }
    renderParticipants();
    return true;
  }

  if (data.type === "call-offer") {
    showIncomingCall(data);
    return true;
  }

  if (data.type === "call-answer") {
    handleCallAnswer(data);
    return true;
  }

  if (data.type === "ice-candidate") {
    handleIceCandidate(data);
    return true;
  }

  if (data.type === "call-hangup" || data.type === "call-decline") {
    const label = data.type === "call-decline" ? "Call declined." : "Call ended.";
    endCall(false, label);
    return true;
  }

  return false;
}

function sendPresence() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "presence-update", name }));
  }
}

function renderParticipants() {
  participantsEl.replaceChildren();

  const others = participants.filter(participant => participant.id !== clientId);
  if (others.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rail-value";
    empty.textContent = "Only you";
    participantsEl.append(empty);
  }

  for (const participant of others) {
    const button = document.createElement("button");
    button.className = `participant-button${participant.id === selectedPeerId ? " is-selected" : ""}`;
    button.type = "button";
    button.addEventListener("click", () => {
      selectedPeerId = participant.id;
      renderParticipants();
      updateCallButtons();
      setSidebarOpen(false);
    });

    const label = document.createElement("span");
    label.className = "participant-name";
    label.textContent = participant.name || "Guest";

    const state = document.createElement("span");
    state.className = "participant-status";
    state.textContent = participant.id === selectedPeerId ? "Selected" : "Online";

    button.append(label, state);
    participantsEl.append(button);
  }

  updateCallButtons();
}

function setSidebarOpen(isOpen) {
  chatShell.classList.toggle("has-sidebar", isOpen);
  sidebarPanel.classList.toggle("is-open", isOpen);
  sidebarBackdrop.hidden = !isOpen;
  sidebarPanel.setAttribute("aria-hidden", String(!isOpen));
  sidebarToggle.setAttribute("aria-expanded", String(isOpen));
  sidebarToggle.title = isOpen ? "Hide sidebar" : "Show sidebar";
  sidebarToggle.setAttribute(
    "aria-label",
    isOpen ? "Hide sidebar" : "Show sidebar"
  );
}

function updateCallButtons() {
  const canCall = Boolean(selectedPeerId) && !peer && ws?.readyState === WebSocket.OPEN;
  audioCallBtn.disabled = !canCall;
  videoCallBtn.disabled = !canCall;
}

function setConnectionState(state) {
  connectionDot.classList.toggle("is-online", state === "online");
  connectionDot.classList.toggle("is-offline", state === "offline");
  connectionText.textContent =
    state === "online" ? "Online" : state === "offline" ? "Offline" : "Connecting";
  sendBtn.disabled = state !== "online";
  updateCallButtons();
}

function clearUnread() {
  unreadCount = 0;
  document.title = originalTitle;
  favicon.href = "/favicon.png?v=1";
}

function isTabInactive() {
  return document.visibilityState !== "visible" || !document.hasFocus();
}

function downloadFile(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function uploadAudio(blob) {
  const filename = `audio_${Date.now()}.webm`;

  let res;
  try {
    res = await fetch(`/audio/upload?name=${encodeURIComponent(filename)}`, {
      method: "POST",
      body: blob
    });
  } catch (err) {
    console.error("Audio upload network error:", err);
    alert("Audio upload failed (network error)");
    return;
  }

  if (!res.ok) {
    alert(`Audio upload failed: ${await res.text()}`);
    return;
  }

  const saved = await res.json();
  sendPayload({
    name,
    type: "audio",
    audio: {
      name: saved.filename,
      url: `/audio/${saved.filename}`
    }
  });
}

function fileIconFor(ext) {
  const map = {
    pdf: "PDF",
    zip: "ZIP",
    rar: "ZIP",
    jar: "JAR",
    "7z": "ZIP",
    txt: "TXT",
    md: "MD",
    json: "JSON",
    js: "JS",
    html: "HTML",
    css: "CSS",
    mp3: "AUD",
    wav: "AUD",
    flac: "AUD",
    ogg: "AUD",
    mp4: "VID",
    webm: "VID",
    mov: "VID",
    exe: "APP",
    apk: "APK"
  };
  return map[ext] || "FILE";
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function startRecording() {
  if (recorder) return;

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    alert("Microphone permission denied");
    return;
  }

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  recorder = new MediaRecorder(audioStream, { mimeType: mime });
  audioChunks = [];

  recorder.addEventListener("dataavailable", event => {
    if (event.data?.size > 0) audioChunks.push(event.data);
  });

  recorder.addEventListener("stop", async () => {
    clearInterval(recTimer);
    recPopup.classList.remove("is-visible");

    const blob = new Blob(audioChunks, { type: recorder.mimeType });
    if (blob.size === 0) {
      alert("Recording failed (0 bytes)");
    } else {
      await uploadAudio(blob);
    }

    audioStream?.getTracks().forEach(track => track.stop());
    recorder = null;
    audioStream = null;
    audioChunks = [];
  });

  recorder.start();
  recStartTs = Date.now();
  recTimeEl.textContent = "00:00";
  recPopup.classList.add("is-visible");

  recTimer = setInterval(() => {
    recTimeEl.textContent = fmtTime(Date.now() - recStartTs);
  }, 250);
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
}

async function uploadSelectedFile() {
  const file = fileInput.files?.[0];
  if (!file) return;

  const res = await fetch(`/files/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file
  });

  if (!res.ok) {
    alert(`Upload failed: ${await res.text()}`);
    fileInput.value = "";
    return;
  }

  const { filename } = await res.json();
  sendPayload({
    name,
    type: "file",
    file: { name: filename, url: `/files/${filename}` }
  });

  fileInput.value = "";
}

async function startCall(kind) {
  if (!selectedPeerId || peer) return;

  const target = participants.find(participant => participant.id === selectedPeerId);
  activePeerId = selectedPeerId;
  activePeerName = target?.name || "Guest";
  activeCallKind = kind;
  setCallStatus(`Calling ${activePeerName}`);

  try {
    await prepareCall(kind);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendPayload({
      type: "call-offer",
      to: activePeerId,
      callKind: kind,
      offer
    });
  } catch (err) {
    console.error("Call start failed:", err);
    endCall(false, "Call failed.");
    alert("Could not start call. Check microphone/camera permissions.");
  }
}

async function prepareCall(kind) {
  callPanel.hidden = false;
  callEmpty.classList.remove("is-hidden");
  updateCallButtons();

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: kind === "video"
  });
  localVideo.srcObject = localStream;
  localVideo.hidden = kind !== "video";

  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  peer = await createPeerConnection();
  peer.addEventListener("icecandidate", event => {
    if (event.candidate?.candidate && activePeerId) {
      if (event.candidate.type === "relay" || event.candidate.candidate.includes(" typ relay ")) {
        localRelayCandidateCount++;
      }
      console.info("Local ICE candidate:", event.candidate.candidate);
      sendPayload({
        type: "ice-candidate",
        to: activePeerId,
        candidate: event.candidate
      });
      return;
    }

    if (!event.candidate || event.candidate.candidate === "") {
      console.info("ICE candidate gathering completed.");
    }
  });
  peer.addEventListener("icecandidateerror", event => {
    lastIceCandidateError = {
      url: event.url,
      errorCode: event.errorCode,
      errorText: event.errorText
    };
    console.warn("ICE candidate error:", {
      url: event.url,
      errorCode: event.errorCode,
      errorText: event.errorText
    });
  });
  peer.addEventListener("icegatheringstatechange", () => {
    console.info("ICE gathering state:", peer?.iceGatheringState);
    if (peer?.iceGatheringState === "complete" && localRelayCandidateCount === 0) {
      setCallStatus(`TURN error ${lastIceCandidateError?.errorCode || ""}`.trim());
    }
  });
  peer.addEventListener("track", event => {
    callEmpty.classList.add("is-hidden");
    for (const track of event.streams[0]?.getTracks() || [event.track]) {
      if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);
    }
  });
  peer.addEventListener("connectionstatechange", () => {
    const state = peer?.connectionState;
    if (state === "connected") {
      clearDisconnectTimer();
      setCallStatus(`In call with ${activePeerName}`);
    }

    if (state === "disconnected") {
      setCallStatus("Connection interrupted...");
      clearDisconnectTimer();
      disconnectTimer = setTimeout(() => {
        endCall(false, "Call disconnected.");
      }, 10000);
    }

    if (state === "failed") {
      endCall(false, "Call disconnected.");
    }
  });
  peer.addEventListener("iceconnectionstatechange", () => {
    if (peer?.iceConnectionState === "failed") {
      endCall(false, "Call failed.");
    }
  });

  for (const track of localStream.getTracks()) {
    peer.addTrack(track, localStream);
  }

  toggleCameraBtn.disabled = kind !== "video";
}

function showIncomingCall(data) {
  if (peer || pendingOffer) {
    sendPayload({ type: "call-decline", to: data.from });
    return;
  }

  pendingOffer = data;
  incomingTitle.textContent = `${data.fromName || "Guest"} is calling`;
  incomingCopy.textContent = data.callKind === "video" ? "Video call" : "Audio call";
  incomingCall.hidden = false;
}

async function acceptIncomingCall() {
  if (!pendingOffer) return;

  const offer = pendingOffer;
  pendingOffer = null;
  incomingCall.hidden = true;
  activePeerId = offer.from;
  activePeerName = offer.fromName || "Guest";
  activeCallKind = offer.callKind === "video" ? "video" : "audio";
  setCallStatus(`In call with ${activePeerName}`);

  try {
    await prepareCall(activeCallKind);
    await peer.setRemoteDescription(offer.offer);
    await flushPendingIceCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendPayload({
      type: "call-answer",
      to: activePeerId,
      answer
    });
  } catch (err) {
    console.error("Call accept failed:", err);
    endCall(true, "Call failed.");
    alert("Could not accept call. Check microphone/camera permissions.");
  }
}

function declineIncomingCall() {
  if (pendingOffer?.from) {
    sendPayload({ type: "call-decline", to: pendingOffer.from });
  }

  pendingOffer = null;
  pendingIceCandidates = [];
  pendingIceCandidateKeys.clear();
  incomingCall.hidden = true;
}

async function handleCallAnswer(data) {
  if (!peer || data.from !== activePeerId) return;

  try {
    await peer.setRemoteDescription(data.answer);
    await flushPendingIceCandidates();
    setCallStatus(`In call with ${data.fromName || activePeerName}`);
  } catch (err) {
    console.error("Answer handling failed:", err);
    endCall(false, "Call failed.");
  }
}

async function handleIceCandidate(data) {
  if (!data.candidate) return;

  const isActivePeer = data.from === activePeerId;
  const isPendingPeer = pendingOffer?.from === data.from;
  if (!isActivePeer && !isPendingPeer) return;

  if (!peer || !peer.remoteDescription) {
    queueIceCandidate(data.candidate);
    return;
  }

  try {
    await peer.addIceCandidate(data.candidate);
  } catch (err) {
    console.error("ICE candidate failed:", err);
  }
}

async function flushPendingIceCandidates() {
  if (!peer?.remoteDescription || pendingIceCandidates.length === 0) return;

  const candidates = pendingIceCandidates;
  pendingIceCandidates = [];
  pendingIceCandidateKeys.clear();

  for (const candidate of candidates) {
    try {
      await peer.addIceCandidate(candidate);
    } catch (err) {
      console.error("Buffered ICE candidate failed:", err);
    }
  }
}

function queueIceCandidate(candidate) {
  const key = [
    candidate.candidate,
    candidate.sdpMid,
    candidate.sdpMLineIndex,
    candidate.usernameFragment
  ].join("|");

  if (pendingIceCandidateKeys.has(key)) return;
  pendingIceCandidateKeys.add(key);
  pendingIceCandidates.push(candidate);
}

function toggleMic() {
  const audioTrack = localStream?.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  toggleMicBtn.classList.toggle("danger-button", !audioTrack.enabled);
  toggleMicBtn.title = audioTrack.enabled ? "Mute microphone" : "Unmute microphone";
}

function toggleCamera() {
  const videoTrack = localStream?.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  toggleCameraBtn.classList.toggle("danger-button", !videoTrack.enabled);
  toggleCameraBtn.title = videoTrack.enabled ? "Turn camera off" : "Turn camera on";
}

function endCall(notifyPeer, status = "Call ended.") {
  if (endingCall) return;
  endingCall = true;

  if (notifyPeer && activePeerId) {
    sendPayload({ type: "call-hangup", to: activePeerId });
  }

  clearDisconnectTimer();
  peer?.close();
  peer = null;
  localStream?.getTracks().forEach(track => track.stop());
  localStream = null;
  remoteStream = null;
  localRelayCandidateCount = 0;
  lastIceCandidateError = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  localVideo.hidden = false;
  pendingOffer = null;
  pendingIceCandidates = [];
  pendingIceCandidateKeys.clear();
  incomingCall.hidden = true;
  activePeerId = null;
  activePeerName = "";
  activeCallKind = "audio";
  callPanel.hidden = true;
  callEmpty.classList.remove("is-hidden");
  toggleMicBtn.classList.remove("danger-button");
  toggleCameraBtn.classList.remove("danger-button");
  toggleCameraBtn.disabled = false;
  setCallStatus(status);
  updateCallButtons();
  endingCall = false;
}

function setCallStatus(status) {
  callStatus.textContent = status;
}

function clearDisconnectTimer() {
  if (!disconnectTimer) return;
  clearTimeout(disconnectTimer);
  disconnectTimer = null;
}

function render(data) {
  if (data.system) {
    renderSystem(data.msg || "System event");
    return;
  }

  const item = document.createElement("article");
  item.className = `message${data.name === name ? " me" : ""}`;

  item.append(createMessageHead(data.name || "Unknown", data.ts));

  if (data.type === "audio" && data.audio) {
    item.append(createAudioMessage(data.audio));
  } else if (data.type === "file" && data.file) {
    item.append(createFileMessage(data.file));
  } else {
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = (data.msg ?? "").toString();
    item.append(text);
  }

  appendMessage(item);
  notify(data);
}

function renderSystem(message) {
  const item = document.createElement("div");
  item.className = "message system";
  item.textContent = message;
  appendMessage(item);
}

function appendMessage(item) {
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function createMessageHead(sender, ts) {
  const head = document.createElement("div");
  head.className = "message-head";

  const senderEl = document.createElement("span");
  senderEl.className = "message-name";
  senderEl.textContent = sender;

  const timeEl = document.createElement("time");
  timeEl.className = "message-time";
  timeEl.textContent = ts ? new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  }) : "";

  head.append(senderEl, timeEl);
  return head;
}

function createAudioMessage(audio) {
  const player = document.createElement("audio");
  player.className = "media-preview";
  player.controls = true;
  player.src = audio.url || "";
  return player;
}

function createFileMessage(file) {
  const fname = file.name || "download";
  const url = file.url || "";
  const ext = fname.includes(".") ? fname.split(".").pop().toLowerCase() : "";
  const imageTypes = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
  const videoTypes = ["mp4", "webm", "ogg", "mov"];

  const wrap = document.createElement("div");

  if (imageTypes.includes(ext)) {
    const img = document.createElement("img");
    img.className = "media-preview";
    img.src = url;
    img.alt = fname;
    wrap.append(img, createFileMeta(fname, url));
    return wrap;
  }

  if (videoTypes.includes(ext)) {
    const video = document.createElement("video");
    video.className = "media-preview";
    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    wrap.append(video, createFileMeta(fname, url));
    return wrap;
  }

  const row = document.createElement("div");
  row.className = "file-row";

  const icon = document.createElement("span");
  icon.className = "file-icon";
  icon.textContent = fileIconFor(ext);

  const label = document.createElement("span");
  label.className = "file-name";
  label.textContent = fname;

  row.append(icon, label, createDownloadButton(url, fname));
  wrap.append(row);
  return wrap;
}

function createFileMeta(fname, url) {
  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.append(document.createTextNode(fname), createDownloadButton(url, fname));
  return meta;
}

function createDownloadButton(url, fname) {
  const button = document.createElement("button");
  button.className = "download-button";
  button.type = "button";
  button.title = "Download file";
  button.setAttribute("aria-label", `Download ${fname}`);
  button.addEventListener("click", () => downloadFile(url, fname));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  const pathOne = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathOne.setAttribute("d", "M12 3v12");
  const pathTwo = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathTwo.setAttribute("d", "m7 10 5 5 5-5");
  const pathThree = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathThree.setAttribute("d", "M5 21h14");

  svg.append(pathOne, pathTwo, pathThree);
  button.append(svg);
  return button;
}

function notify(data) {
  if (
    loadingHistory ||
    data.name === name ||
    !isTabInactive() ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  unreadCount++;
  document.title = `(${unreadCount}) New message`;
  favicon.href = "/favicon-unread.png?v=1";

  const preview =
    data.type === "file" ? `File: ${data.file?.name || "file"}`
    : data.type === "audio" ? "Voice message"
    : (data.msg || "").slice(0, 120);

  const notification = new Notification(`New message from ${data.name}`, {
    body: preview,
    silent: true
  });
  notification.addEventListener("click", () => {
    window.focus();
    notification.close();
  });
}

function send() {
  const msg = input.value.trim();
  if (!msg) return;
  sendPayload({ name, msg });
  input.value = "";
}

function sendPayload(payload) {
  if (ws?.readyState !== WebSocket.OPEN) {
    renderSystem("Cannot send while disconnected.");
    return;
  }

  ws.send(JSON.stringify(payload));
}
