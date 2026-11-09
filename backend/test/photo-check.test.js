const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createPhotoChecker, savePhotoCheck } = require('../src/photo_check');

// A stand-in for the Anthropic client: records each request and replies with `reply`.
function fakeClient(reply) {
  const requests = [];
  return {
    requests,
    messages: {
      async create(request) {
        requests.push(request);
        return typeof reply === 'function' ? reply(request) : reply;
      },
    },
  };
}
const answer = (body, extra = {}) => ({
  stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }], ...extra,
});
const photo = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#777' } }).jpeg().toBuffer();

test('the photo goes to Claude shrunk, with a fixed answer format', async () => {
  const client = fakeClient(answer({ category: 'pothole', confidence: 'high', reason: '  حفرة واضحة في الطريق.  ' }));
  const checker = createPhotoChecker({ client });
  const result = await checker.classify(await photo());

  assert.deepEqual(result, { category: 'pothole', confidence: 'high', reason: 'حفرة واضحة في الطريق.' });
  const [request] = client.requests;
  assert.equal(request.model, 'claude-haiku-5-5');
  assert.equal(request.output_config.effort, 'low');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.output_config.format.schema.properties.category.enum,
    ['pothole', 'water_leak', 'garbage', 'other']);
  const image = request.messages[0].content.find((block) => block.type === 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  const sent = await sharp(Buffer.from(image.source.data, 'base64')).metadata();
  assert.equal(Math.max(sent.width, sent.height), 1024, 'large photos are shrunk before sending');
});

test('a declined, unreadable or unexpected answer is an error, never a guess', async () => {
  const image = await photo();
  const declined = createPhotoChecker({ client: fakeClient({ stop_reason: 'refusal', stop_details: { category: 'bio' }, content: [] }) });
  await assert.rejects(declined.classify(image), /declined/);
  const cut = createPhotoChecker({ client: fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"categ' }] }) });
  await assert.rejects(cut.classify(image), /no usable answer/);
  const outside = createPhotoChecker({ client: fakeClient(answer({ category: 'tree', confidence: 'high', reason: 'شجرة' })) });
  await assert.rejects(outside.classify(image), /expected choices/);
  const empty = createPhotoChecker({ client: fakeClient(answer({ category: 'other', confidence: 'low', reason: '  ' })) });
  await assert.rejects(empty.classify(image), /expected choices/);
});

test('a long reason is cut to what the database holds', async () => {
  const checker = createPhotoChecker({ client: fakeClient(answer({ category: 'garbage', confidence: 'medium', reason: 'ق'.repeat(900) })) });
  assert.equal((await checker.classify(await photo())).reason.length, 500);
});

test('a result is saved only when the report has none yet', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rowCount: 0 }; } };
  const saved = await savePhotoCheck(pool, '7', { category: 'other', confidence: 'low', reason: 'صورة مظلمة' }, 'staff-id');
  assert.equal(saved, false);
  assert.match(calls[0].sql, /ai_checked_at IS NULL/);
  assert.deepEqual(calls[0].params, ['7', 'other', 'low', 'صورة مظلمة', 'staff-id']);
});
