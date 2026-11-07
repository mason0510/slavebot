import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Dieser Slavebot wurde für den WebRTC-Zugriff registriert.",
  "status.host.keyRotated": "Serverschlüssel geändert. Gekoppelte Geräte bleiben gekoppelt.",
  "status.host.identityUpdated": "Serveridentität aktualisiert.",
  "status.host.starting": "WebRTC-Host wird gestartet…",
  "status.host.ready": "Dieser Slavebot ist für WebRTC-Verbindungen bereit.",
  "status.host.stopping": "Dieser Slavebot wird auf privat gesetzt…",
  "status.host.private": "Dieser Slavebot ist privat.",
} as const satisfies PartialTranslation<typeof source>;
