import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Se registró este Slavebot para el acceso WebRTC.",
  "status.host.keyRotated": "Clave del servidor cambiada. Los dispositivos vinculados siguen vinculados.",
  "status.host.identityUpdated": "Identidad del servidor actualizada.",
  "status.host.starting": "Iniciando el host WebRTC…",
  "status.host.ready": "Este Slavebot está listo para conexiones WebRTC.",
  "status.host.stopping": "Haciendo privado este Slavebot…",
  "status.host.private": "Este Slavebot es privado.",
} as const satisfies PartialTranslation<typeof source>;
