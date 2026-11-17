// Phoenix stays real; only the WebSocket under it is faked. A dead link takes
// bytes and answers nothing, and its close handshake may never complete.
export class FakeWebSocket {
  static made: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = 'arraybuffer';
  bufferedAmount = 0;
  closeAfterMs: number | null = 80;
  dead = false;
  joins: string[] = [];
  /** What the server answers a join or a push with; `{}` unless a test says more. */
  respond = (_topic: string, _event: string): object => ({});
  onopen = () => {};
  onclose = (_event: unknown) => {};
  onerror = (_event: unknown) => {};
  onmessage = (_event: { data: string }) => {};

  constructor() {
    FakeWebSocket.made.push(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen();
    }, 5);
  }

  send(raw: string) {
    const [joinRef, ref, topic, event] = JSON.parse(raw);
    if (event === 'phx_join') this.joins.push(topic);
    if (this.dead) return;
    // Phoenix answers a push for a topic this connection never joined like this, with no join ref.
    const known = topic === 'phoenix' || this.joins.includes(topic);
    const status = known ? 'ok' : 'error';
    const response = known ? this.respond(topic, event) : { reason: 'unmatched topic' };
    setTimeout(() => {
      if (this.readyState !== 1) return;
      const reply = [known ? joinRef : null, ref, topic, 'phx_reply', { status, response }];
      this.onmessage({ data: JSON.stringify(reply) });
    }, 1);
  }

  close() {
    this.readyState = 2;
    const after = this.closeAfterMs;
    if (after === null) return;
    setTimeout(() => {
      this.readyState = 3;
      this.onclose({ code: 1000 });
    }, after);
  }
}
