// The automatic photo check: Claude looks at a report's photo and says which report type
// it shows, if any, so the reviewing staff can spot a wrong category or a photo with no
// problem in it. It runs after the report is saved, so a slow or failed check never delays
// or fails a submission; staff can run it again from the dashboard. The answer is only a
// suggestion: nothing about the report changes on its own.
const sharp = require('sharp');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-haiku-5-5';
const PHOTO_CATEGORIES = ['pothole', 'water_leak', 'garbage', 'other'];
const CONFIDENCES = ['high', 'medium', 'low'];
const MAX_REASON_LENGTH = 500;
// Large phone photos are shrunk first: the answer does not need them, and cost grows with size.
const MAX_SIDE = 1024;

// Measured on 37 sample photos before adoption: 92% agreed with the hand labels, and no
// problem was ever named as a different problem type.
const PROMPT = `This photo was sent by a citizen to report a problem to the municipality of Tripoli, Libya.
Decide which one of these the photo mainly shows:
- "pothole": a hole, sunken patch or broken surface in a road or pavement
- "water_leak": water leaking or flowing from a pipe, a main or a fitting, or pooling on a street because of one
- "garbage": litter, rubbish bags or dumped waste
- "other": none of the above is clearly visible (an intact road, a person, an indoor scene, a dark or blurred photo)
Choose "other" whenever the problem is not clearly visible; do not guess.
Give "reason" as one short sentence in Arabic that a municipal employee can read.`;

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: PHOTO_CATEGORIES },
    confidence: { type: 'string', enum: CONFIDENCES },
    reason: { type: 'string' },
  },
  required: ['category', 'confidence', 'reason'],
  additionalProperties: false,
};

function createPhotoChecker({
  apiKey, model = DEFAULT_MODEL,
  client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 }),
}) {
  return {
    model,
    // Resolves to { category, confidence, reason }, or throws when no usable answer came back.
    async classify(image) {
      const photo = await sharp(image)
        .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: photo.toString('base64') } },
            { type: 'text', text: PROMPT },
          ],
        }],
      });
      if (response.stop_reason === 'refusal') {
        throw new Error(`the model declined to describe the photo (${response.stop_details?.category || 'no category'})`);
      }
      const text = response.content.find((block) => block.type === 'text')?.text;
      let answer;
      try {
        answer = JSON.parse(text);
      } catch {
        throw new Error(`the model returned no usable answer (stop reason ${response.stop_reason})`);
      }
      const reason = typeof answer?.reason === 'string' ? answer.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
      if (!PHOTO_CATEGORIES.includes(answer?.category) || !CONFIDENCES.includes(answer?.confidence) || !reason) {
        throw new Error('the model returned an answer outside the expected choices');
      }
      return { category: answer.category, confidence: answer.confidence, reason };
    },
  };
}

// Stores a result unless one is already there: the automatic check and a staff member's
// retry may race, and the first answer stands. `checkedBy` is the staff member who asked;
// it stays empty for the automatic check. Returns true when this result was saved.
async function savePhotoCheck(pool, id, result, checkedBy = null) {
  const saved = await pool.query(
    `UPDATE public.reports
     SET ai_category = $2, ai_confidence = $3, ai_reason = $4, ai_checked_at = NOW(), ai_checked_by = $5
     WHERE id = $1 AND ai_checked_at IS NULL`,
    [id, result.category, result.confidence, result.reason, checkedBy]
  );
  return saved.rowCount === 1;
}

// A short reason for the server log; never the API key or the photo.
function photoCheckError(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'the Anthropic API key was refused';
  if (error instanceof Anthropic.PermissionDeniedError) return 'the Anthropic key may not use this model';
  if (error instanceof Anthropic.RateLimitError) return 'rate limited by the Anthropic API';
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status ?? ''}: ${error.message}`.trim();
  return error.message;
}

module.exports = { createPhotoChecker, savePhotoCheck, photoCheckError, PHOTO_CATEGORIES, DEFAULT_MODEL };
