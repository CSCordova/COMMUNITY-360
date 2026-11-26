export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, options = {}) {
  const controller = new AbortController();
  const external = options.signal;
  const cancel = () => controller.abort();
  external?.addEventListener('abort', cancel, { once: true });
  if (external?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      ...options, credentials: 'same-origin', signal: controller.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 422 ? 'Revisa los datos del formulario.'
        : typeof data.detail === 'string' ? data.detail : 'No se pudo completar la solicitud.';
      throw new ApiError(message, response.status);
    }
    return data;
  } catch (error) {
    if (external?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError('No pudimos conectar. Comprueba tu conexión e inténtalo de nuevo.', 0);
  } finally { clearTimeout(timeout); external?.removeEventListener('abort', cancel); }
}
