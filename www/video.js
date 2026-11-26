// CEVIRI - Online odada kamera (ve ayni dildeki sesli sohbet)
//
// Odadaki herkes ayni dili konusuyorsa ceviri gerekmez: o zaman mikrofon sesi
// de bu baglantilar uzerinden dogrudan gider (startAudio / stopAudio).
//
// Her katilimci cifti arasinda dogrudan WebRTC baglantisi kurulur (en fazla
// 6 kisi = 5 baglanti). Goruntu sesSIZ gider: mikrofon konusma tanimaya
// ayrilmis kalir, duyulan ses herkesin kendi dilindeki ceviri seslendirmesidir.
// Baglanti kurma mesajlari (teklif/cevap/aday) odanin sifreli kanalindan gider.
// "Kibar esler" (perfect negotiation) yontemiyle iki taraf ayni anda teklif
// yaparsa da karisiklik olmaz.

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const MAX_ICE_RESTARTS = 2;
const VIDEO_CONSTRAINTS = {
  video: {
    facingMode: 'user',
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 15, max: 20 },
  },
  audio: false,
};
const MAX_BITRATE = 300000; // ~300 kbps: 6 kisilik odada mobil veriyi korur
const AUDIO_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export function createVideoMesh({ selfId, roomCode, sendSignal, onRemoteStream, onRemoteAudio, onPeerState }) {
  const peers = new Map(); // id -> { pc, polite, makingOffer, ignoreOffer, sender }
  let localStream = null;
  let audioStream = null; // ayni dildeki sesli sohbet icin mikrofon
  let audioMuted = false;
  let destroyed = false;
  let receiveVideo = true; // false: "Goruntuleri alma" (veri tasarrufu)

  function send(to, data) {
    if (!destroyed) sendSignal(to, data);
  }

  function limitBitrate(sender) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = MAX_BITRATE;
      sender.setParameters(params).catch(() => {});
    } catch {
      // eski tarayici
    }
  }

  // Alma tercihini baglantiya uygula: almak istemiyorsak karsi taraf goruntu
  // GONDERMEZ (yon 'sendonly'/'inactive' olur, mobil veri harcanmaz)
  function applyDirections(peer) {
    for (const tr of peer.pc.getTransceivers()) {
      if (tr.stopped || (tr.receiver && tr.receiver.track && tr.receiver.track.kind !== 'video')) continue;
      const sending = Boolean(peer.sender && tr.sender === peer.sender && tr.sender.track);
      const want = sending ? (receiveVideo ? 'sendrecv' : 'sendonly') : receiveVideo ? 'recvonly' : 'inactive';
      if (tr.direction !== want) {
        try {
          tr.direction = want;
        } catch {
          // kapali aktarici
        }
      }
    }
  }

  function addLocalTrack(peer) {
    if (!localStream || peer.sender) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    peer.sender = peer.pc.addTrack(track, localStream);
    limitBitrate(peer.sender);
    applyDirections(peer);
  }

  function addLocalAudio(peer) {
    if (!audioStream || peer.audioSender) return;
    const track = audioStream.getAudioTracks()[0];
    if (!track) return;
    peer.audioSender = peer.pc.addTrack(track, audioStream);
  }

  function createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = {
      id,
      pc,
      polite: String(selfId) > String(id),
      makingOffer: false,
      ignoreOffer: false,
      sender: null,
      audioSender: null,
      queue: Promise.resolve(), // gelen sinyaller bu kisi icin SIRAYLA islenir
      pendingCandidates: [], // teklif/cevap gelmeden ulasan adaylar bekletilir
      restarts: 0,
    };
    peers.set(id, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        send(id, { description: pc.localDescription.toJSON() });
      } catch {
        // yeniden denenir
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send(id, { candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = (streams && streams[0]) || new MediaStream([track]);
      if (track.kind === 'audio') {
        if (onRemoteAudio) {
          onRemoteAudio(id, stream);
          track.addEventListener('ended', () => onRemoteAudio(id, null));
        }
        return;
      }
      onRemoteStream(id, stream);
      track.addEventListener('ended', () => onRemoteStream(id, null));
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') peer.restarts = 0;
      // Baglanti koparsa ICE'i yeniden baslat (ag degisimi, kisa kopma)
      if (st === 'failed' && peer.restarts < MAX_ICE_RESTARTS) {
        peer.restarts += 1;
        try {
          pc.restartIce();
        } catch {
          // eski tarayici
        }
      }
      if (onPeerState) onPeerState(id, st);
    };
    addLocalTrack(peer);
    addLocalAudio(peer);
    return peer;
  }

  async function flushCandidates(peer) {
    const list = peer.pendingCandidates.splice(0);
    for (const c of list) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
        // gecersiz aday: yoksay
      }
    }
  }

  async function processSignal(peer, data) {
    const { pc } = peer;
    if (pc.signalingState === 'closed') return;
    if (data.description) {
      const desc = data.description;
      if (desc.type === 'answer' && pc.signalingState !== 'have-local-offer') return; // eski/yinelenen cevap
      const offerCollision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      await flushCandidates(peer);
      if (desc.type === 'offer') {
        applyDirections(peer);
        await pc.setLocalDescription();
        send(peer.id, { description: pc.localDescription.toJSON() });
      }
    } else if (data.candidate) {
      if (!pc.remoteDescription) {
        // Teklif/cevap henuz islenmedi: adayi beklet
        peer.pendingCandidates.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(data.candidate);
      } catch {
        if (!peer.ignoreOffer) peer.pendingCandidates.push(data.candidate);
      }
    }
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch {
      // yoksay
    }
    peers.delete(id);
    onRemoteStream(id, null);
    if (onRemoteAudio) onRemoteAudio(id, null);
  }

  return {
    roomCode,
    get cameraOn() {
      return Boolean(localStream);
    },
    get localStream() {
      return localStream;
    },

    /** Odadaki uye listesine gore baglantilari ac/kapat. */
    syncPeers(memberIds) {
      if (destroyed) return;
      const wanted = new Set(memberIds.filter((id) => id && id !== selfId));
      for (const id of [...peers.keys()]) if (!wanted.has(id)) closePeer(id);
      for (const id of wanted) if (!peers.has(id)) createPeer(id);
    },

    handleSignal(from, data) {
      if (destroyed || !data) return Promise.resolve();
      const peer = peers.get(from) || createPeer(from);
      // Ayni kisiden gelen sinyaller sirayla: bir teklif islenirken gelen aday kaybolmasin
      peer.queue = peer.queue.then(() => processSignal(peer, data)).catch(() => {});
      return peer.queue;
    },

    async startCamera() {
      if (localStream) return localStream;
      localStream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
      for (const peer of peers.values()) addLocalTrack(peer);
      return localStream;
    },

    stopCamera() {
      if (!localStream) return;
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      for (const peer of peers.values()) {
        if (peer.sender) {
          try {
            peer.pc.removeTrack(peer.sender);
          } catch {
            // yoksay
          }
          peer.sender = null;
          applyDirections(peer);
        }
      }
    },

    get audioOn() {
      return Boolean(audioStream);
    },

    get audioMuted() {
      return audioMuted;
    },

    /** Ayni dildeki sesli sohbet: mikrofonu ac ve herkese gonder. */
    async startAudio() {
      if (audioStream) return audioStream;
      audioStream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      audioStream.getAudioTracks().forEach((t) => (t.enabled = !audioMuted));
      for (const peer of peers.values()) addLocalAudio(peer);
      return audioStream;
    },

    stopAudio() {
      if (!audioStream) return;
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
      for (const peer of peers.values()) {
        if (peer.audioSender) {
          try {
            peer.pc.removeTrack(peer.audioSender);
          } catch {
            // yoksay
          }
          peer.audioSender = null;
        }
      }
    },

    /** Mikrofonu anlik kapat/ac (baglanti kopmaz). */
    setAudioMuted(muted) {
      audioMuted = Boolean(muted);
      if (audioStream) audioStream.getAudioTracks().forEach((t) => (t.enabled = !audioMuted));
    },

    get receiveVideo() {
      return receiveVideo;
    },

    /** Veri tasarrufu: false ise diger kisiler bana goruntu gondermez. */
    setReceiveVideo(on) {
      receiveVideo = Boolean(on);
      for (const peer of peers.values()) applyDirections(peer);
    },

    destroy() {
      this.stopCamera();
      this.stopAudio();
      for (const id of [...peers.keys()]) closePeer(id);
      destroyed = true;
    },
  };
}
