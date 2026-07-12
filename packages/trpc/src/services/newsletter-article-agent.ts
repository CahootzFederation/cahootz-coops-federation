import { Agent, run, webSearchTool } from '@openai/agents';
import { z } from 'zod';

export interface ArticleResearchResult {
  title: string;
  sourceUrl: string;
  sourceName: string;
  summary: string;
  relevanceScore: number;
  recommendedNextAction: 'draft_article' | 'draft_event' | 'human_review' | 'ignore';
  reasonForFit: string;
}

export interface ArticleSample {
  title: string;
  summary: string;
  contentMarkdown?: string;
}

export interface GeneratedArticleDraft {
  title: string;
  summary: string;
  contentMarkdown: string;
  ctaLabel?: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceName: string;
  reasonForFit: string;
}

interface VerifiedArticleSource {
  sourceTitle: string;
  sourceUrl: string;
  sourceName: string;
  sourcePublishedDate: string;
  sourceSummary: string;
  goalFit: string;
  factualSubstance: string[];
  noveltyRationale: string;
}

interface ArticleAngleSelection {
  proposedTitle: string;
  editorialAngle: string;
  readerValue: string;
  keySourceFacts: string[];
  doNotClaim: string[];
}

const ArticleResearchPickSchema = z.object({
  sourceTitle: z.string(),
  sourceUrl: z.string(),
  sourceName: z.string(),
  summary: z.string(),
  reasonForFit: z.string(),
  editorialAngle: z.string(),
});

const ArticleSourceVerificationSchema = z.object({
  approved: z.boolean(),
  sourceTitle: z.string(),
  sourceUrl: z.string(),
  sourceName: z.string(),
  sourcePublishedDate: z.string(),
  sourceSummary: z.string(),
  goalFit: z.string(),
  factualSubstance: z.array(z.string()),
  noveltyRationale: z.string(),
  rejectionReason: z.string(),
});

const ArticleAngleSchema = z.object({
  approved: z.boolean(),
  proposedTitle: z.string(),
  editorialAngle: z.string(),
  readerValue: z.string(),
  keySourceFacts: z.array(z.string()),
  doNotClaim: z.array(z.string()),
  rejectionReason: z.string(),
});

const ArticleDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  contentMarkdown: z.string(),
  ctaLabel: z.string().optional(),
});

const ArticleQualityGateSchema = z.object({
  approved: z.boolean(),
  finalTitle: z.string(),
  finalSummary: z.string(),
  finalContentMarkdown: z.string(),
  ctaLabel: z.string().optional(),
  qualityNotes: z.string(),
  rejectionReason: z.string(),
});

function firstSentence(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)[0]
    ?.trim() || '';
}

function sanitizeAgentText(value: string) {
  return value
    .replace(/cite[^]*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeHttpUrl(value: string) {
  try {
    const parsedUrl = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function hasConcreteValue(value: string) {
  const normalized = sanitizeAgentText(value).toLowerCase();
  if (!normalized) return false;
  return ![
    'unknown',
    'tbd',
    'n/a',
    'na',
    'none',
    'not listed',
    'not available',
    'needs source',
    'needs confirmation',
    'needs confirmed date',
    'needs confirmed location',
    'to be announced',
    'coming soon',
  ].some((placeholder) => normalized === placeholder || normalized.includes(placeholder));
}

function cleanAgentList(values: string[], limit = 8) {
  return values
    .map(sanitizeAgentText)
    .filter(hasConcreteValue)
    .slice(0, limit);
}

function clampArticleMarkdown(value: string, maxLength = 20000) {
  const sanitized = sanitizeAgentText(value);
  if (sanitized.length <= maxLength) return sanitized;

  const suffix = '\n\n## Editor note\nThis draft was shortened automatically; review the source before publishing.';
  const cutLimit = maxLength - suffix.length;
  const roughCut = sanitized.slice(0, cutLimit);
  const paragraphCut = roughCut.lastIndexOf('\n\n');
  const sentenceCut = roughCut.lastIndexOf('. ');
  const cutAt = paragraphCut > 12000 ? paragraphCut : sentenceCut > 12000 ? sentenceCut + 1 : cutLimit;

  return `${roughCut.slice(0, cutAt).trim()}${suffix}`;
}

function subjectFingerprint(value: string) {
  const stopWords = new Set([
    'about',
    'after',
    'black',
    'brief',
    'build',
    'building',
    'community',
    'coop',
    'could',
    'first',
    'from',
    'guide',
    'inside',
    'into',
    'local',
    'member',
    'members',
    'month',
    'news',
    'owned',
    'power',
    'story',
    'this',
    'turns',
    'what',
    'when',
    'where',
    'with',
  ]);

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3 && !stopWords.has(token))
    .slice(0, 5)
    .sort()
    .join(' ');
}

export function hasSubjectOverlap(title: string, existingTitles: string[]) {
  const nextTokens = new Set(subjectFingerprint(title).split(/\s+/).filter(Boolean));
  if (nextTokens.size === 0) return false;

  return existingTitles.some((existingTitle) => {
    const existingTokens = new Set(subjectFingerprint(existingTitle).split(/\s+/).filter(Boolean));
    if (existingTokens.size === 0) return false;
    const overlap = [...nextTokens].filter((token) => existingTokens.has(token)).length;
    return overlap >= 2 || overlap / Math.min(nextTokens.size, existingTokens.size) >= 0.6;
  });
}

export function extractArticleSamples(posts: unknown[]): ArticleSample[] {
  return posts
    .filter((post): post is Record<string, unknown> => typeof post === 'object' && post !== null && !Array.isArray(post))
    .filter((post) => post.type === 'article')
    .map((post) => ({
      title: typeof post.title === 'string' ? post.title.trim() : '',
      summary: typeof post.summary === 'string' ? post.summary.trim() : '',
      contentMarkdown: typeof post.contentMarkdown === 'string' ? post.contentMarkdown.trim() : undefined,
    }))
    .filter((post) => post.title && post.summary)
    .slice(0, 8);
}

export function buildArticleWriterBrief(params: {
  coopName: string;
  coopDescription: string;
  missionGoals: string[];
  articleSamples: ArticleSample[];
  researchResults?: ArticleResearchResult[];
}) {
  const goalText = params.missionGoals.slice(0, 3).join(', ') || 'member ownership, local economic power, and community participation';
  const previousSubjects = params.articleSamples.map((sample) => sample.title);
  const sampleLines = params.articleSamples.length > 0
    ? params.articleSamples.map((sample) => `- "${sample.title}": ${sample.summary}`).join('\n')
    : [
        `- No prior ${params.coopName} articles are available yet. Infer a restrained publication voice from the co-op description and stated goals.`,
        '- Keep paragraphs short, use clear section headings, and include practical bullets only when they clarify action.',
      ].join('\n');
  const researchLines = (params.researchResults ?? [])
    .filter((result) => result.relevanceScore >= 0.45 && result.recommendedNextAction !== 'ignore')
    .slice(0, 5)
    .map((result) => `- ${result.title} (${result.sourceName}): ${result.summary}`)
    .join('\n');
  const styleGuide = [
    "Write like this co-op's publication, not a marketing page.",
    "Use plain, direct sentences in the co-op's own domain and avoid importing assumptions from another co-op.",
    'Open with the concrete point, then explain why it matters to this co-op\'s members or audience.',
    'Use two short sections with markdown headings; add bullets only for clear member actions or takeaways.',
    'Do not reuse the same subject as a prior article. Prior titles are off-limits for topic, not just wording.',
    'Do not claim an event happened, a person said something, or a result exists unless the source says it.',
    'If facts are thin, write a draft angle for admin review instead of pretending the article is complete.',
  ];

  return {
    styleGuide,
    previousSubjects,
    prompt: [
      `You are writing a ${params.coopName} community newspaper article.`,
      `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}.`,
      `Goals to align with: ${goalText}.`,
      '',
      'House style examples to learn tone and article type from, not subjects to repeat:',
      sampleLines,
      '',
      'Do-not-repeat subjects:',
      previousSubjects.length > 0 ? previousSubjects.map((title) => `- ${title}`).join('\n') : '- None published yet.',
      '',
      'Fresh research candidates:',
      researchLines || '- No cached research candidates. Ask for research before writing a full article.',
      '',
      'Writing rules:',
      styleGuide.map((rule) => `- ${rule}`).join('\n'),
    ].join('\n'),
  };
}

export async function generateArticleDraftWithAgentOrchestration(params: {
  briefPrompt: string;
  source?: ArticleResearchResult;
  existingTitles: string[];
  coopName: string;
  coopDescription: string;
  missionGoals: string[];
}): Promise<GeneratedArticleDraft | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const model = process.env.NEWSLETTER_ARTICLE_MODEL || 'gpt-5.2';
  const researchAgent = new Agent({
    name: 'Newsletter Article Research Curator Agent',
    instructions: [
      'Find or select one real source for a specific co-op newsletter article.',
      'Use web_search when cached research is missing, thin, stale, or too generic.',
      'Never pick the same subject as an existing title.',
      'Prefer specific articles, reports, local news, public programs, community resources, member business support, civic/economic developments, or practical ownership examples.',
      'Reject generic co-op explainers, motivational content, evergreen pages with no concrete facts, and sources that could produce the same article for any co-op.',
      'Return one real source URL and a possible editorial angle. Do not invent sources.',
    ].join('\n'),
    model,
    outputType: ArticleResearchPickSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: 'auto' },
  });

  const researchInput = [
    params.source
      ? [
          'Evaluate this cached source and decide whether it is strong enough for a fresh article.',
          `Source title: ${params.source.title}`,
          `Source URL: ${params.source.sourceUrl}`,
          `Source summary: ${params.source.summary}`,
          `Existing fit reason: ${params.source.reasonForFit}`,
        ].join('\n')
      : [
          `Search for one fresh article source for ${params.coopName}.`,
          `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}.`,
          `Goals: ${params.missionGoals.join(', ') || 'member ownership, local economic power, community participation'}.`,
        ].join('\n'),
    `Do-not-repeat existing titles: ${params.existingTitles.join('; ') || 'none'}`,
  ].join('\n\n');

  const researchResult = await run(researchAgent, researchInput) as unknown as {
    finalOutput?: z.infer<typeof ArticleResearchPickSchema>;
    output?: z.infer<typeof ArticleResearchPickSchema>;
  };
  const sourcePick = researchResult.finalOutput ?? researchResult.output;
  if (!sourcePick || !sourcePick.sourceTitle.trim() || hasSubjectOverlap(sourcePick.sourceTitle, params.existingTitles)) return null;
  const parsedSourceUrl = normalizeHttpUrl(sourcePick.sourceUrl);
  if (!parsedSourceUrl) return null;
  sourcePick.sourceUrl = parsedSourceUrl;

  const sourceVerifierAgent = new Agent({
    name: 'Newsletter Article Source Verifier Agent',
    instructions: [
      'Verify whether the selected source is strong enough to support a non-generic co-op newsletter article.',
      'Use web_search and the selected source URL to verify the source.',
      'Approve only when the source has a real URL, concrete factual substance, enough detail for a specific article, goal-based usefulness for this co-op, and a topic that does not repeat prior titles.',
      'Reject generic co-op explainers, thin summaries, motivational content, sources with unclear facts, sources that only support broad commentary, or sources that would make the same article for any co-op.',
      'sourcePublishedDate may be a publish date, event/program date, report date, or a plain explanation of why the source is still useful.',
      'Return factualSubstance as concrete facts traceable to the source. If the source is weak, approved must be false and rejectionReason must explain why.',
    ].join('\n'),
    model,
    outputType: ArticleSourceVerificationSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: 'auto' },
  });

  const verificationResult = await run(sourceVerifierAgent, [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Co-op: ${params.coopName}`,
    `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}`,
    `Goals that define usefulness: ${params.missionGoals.join(', ') || 'member ownership, local economic power, community participation'}`,
    `Existing titles that must not be repeated: ${params.existingTitles.join('; ') || 'none'}`,
    '',
    'Selected source:',
    `Source title: ${sourcePick.sourceTitle}`,
    `Source URL: ${sourcePick.sourceUrl}`,
    `Source name: ${sourcePick.sourceName}`,
    `Source summary: ${sourcePick.summary}`,
    `Possible editorial angle: ${sourcePick.editorialAngle}`,
    `Why it may fit: ${sourcePick.reasonForFit}`,
  ].join('\n')) as unknown as {
    finalOutput?: z.infer<typeof ArticleSourceVerificationSchema>;
    output?: z.infer<typeof ArticleSourceVerificationSchema>;
  };

  const verification = verificationResult.finalOutput ?? verificationResult.output;
  if (!verification?.approved) return null;
  const verifiedSourceUrl = normalizeHttpUrl(verification.sourceUrl) || sourcePick.sourceUrl;
  const verifiedFacts = cleanAgentList(verification.factualSubstance, 8);
  const verifiedSource: VerifiedArticleSource = {
    sourceTitle: sanitizeAgentText(verification.sourceTitle || sourcePick.sourceTitle),
    sourceUrl: verifiedSourceUrl,
    sourceName: sanitizeAgentText(verification.sourceName || sourcePick.sourceName),
    sourcePublishedDate: sanitizeAgentText(verification.sourcePublishedDate),
    sourceSummary: sanitizeAgentText(verification.sourceSummary),
    goalFit: sanitizeAgentText(verification.goalFit),
    factualSubstance: verifiedFacts,
    noveltyRationale: sanitizeAgentText(verification.noveltyRationale),
  };

  if (
    !hasConcreteValue(verifiedSource.sourceTitle) ||
    !hasConcreteValue(verifiedSource.sourceSummary) ||
    !hasConcreteValue(verifiedSource.sourcePublishedDate) ||
    !hasConcreteValue(verifiedSource.goalFit) ||
    !hasConcreteValue(verifiedSource.noveltyRationale) ||
    verifiedSource.factualSubstance.length < 3 ||
    hasSubjectOverlap(verifiedSource.sourceTitle, params.existingTitles)
  ) {
    return null;
  }

  const angleSelectorAgent = new Agent({
    name: 'Newsletter Article Angle Selector Agent',
    instructions: [
      'Choose one specific editorial angle before the article is written.',
      'The angle must be grounded in the verified source facts and useful because of this co-op\'s stated goals.',
      'Do not choose broad angles like why community matters, why co-ops matter, member ownership 101, or generic participation advice.',
      'Reject the source if the best available angle could apply to any co-op or repeats a prior subject.',
      'Return the exact key source facts the writer should use and claims the writer must avoid.',
    ].join('\n'),
    model,
    outputType: ArticleAngleSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: 'auto' },
  });

  const angleResult = await run(angleSelectorAgent, [
    `Co-op: ${params.coopName}`,
    `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}`,
    `Goals that define usefulness: ${params.missionGoals.join(', ') || 'member ownership, local economic power, community participation'}`,
    `Existing titles that must not be repeated: ${params.existingTitles.join('; ') || 'none'}`,
    '',
    'Verified source:',
    `Source title: ${verifiedSource.sourceTitle}`,
    `Source URL: ${verifiedSource.sourceUrl}`,
    `Source name: ${verifiedSource.sourceName}`,
    `Source date/usefulness: ${verifiedSource.sourcePublishedDate}`,
    `Source summary: ${verifiedSource.sourceSummary}`,
    `Verified facts: ${verifiedSource.factualSubstance.join(' | ')}`,
    `Goal fit: ${verifiedSource.goalFit}`,
    `Novelty rationale: ${verifiedSource.noveltyRationale}`,
  ].join('\n')) as unknown as {
    finalOutput?: z.infer<typeof ArticleAngleSchema>;
    output?: z.infer<typeof ArticleAngleSchema>;
  };

  const angleOutput = angleResult.finalOutput ?? angleResult.output;
  if (!angleOutput?.approved) return null;
  const articleAngle: ArticleAngleSelection = {
    proposedTitle: sanitizeAgentText(angleOutput.proposedTitle),
    editorialAngle: sanitizeAgentText(angleOutput.editorialAngle),
    readerValue: sanitizeAgentText(angleOutput.readerValue),
    keySourceFacts: cleanAgentList(angleOutput.keySourceFacts, 8),
    doNotClaim: cleanAgentList(angleOutput.doNotClaim, 8),
  };

  if (
    !hasConcreteValue(articleAngle.proposedTitle) ||
    !hasConcreteValue(articleAngle.editorialAngle) ||
    !hasConcreteValue(articleAngle.readerValue) ||
    articleAngle.keySourceFacts.length < 3 ||
    hasSubjectOverlap(articleAngle.proposedTitle, params.existingTitles)
  ) {
    return null;
  }

  const writerAgent = new Agent({
    name: 'Newsletter Article Writer Agent',
    instructions: [
      params.briefPrompt,
      '',
      'You are the fourth agent in the orchestration. The Research Curator, Source Verifier, and Angle Selector have already selected the source and article angle.',
      'Write a publishable community newspaper article draft from the verified source and selected angle.',
      'Do not write a template, task list, editor note, source summary, or generic explainer.',
      'Do not repeat a prior subject. If the topic feels too similar, choose a different framing from the source.',
      'Use concrete facts from the verified source. Do not add claims listed in doNotClaim.',
      'The article should not read like it could be reused for every co-op.',
    ].join('\n'),
    model,
    outputType: ArticleDraftSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: 'auto' },
  });

  const writerResult = await run(writerAgent, [
    `Verified source: ${verifiedSource.sourceTitle}`,
    `Source URL: ${verifiedSource.sourceUrl}`,
    `Source name: ${verifiedSource.sourceName}`,
    `Source date/usefulness: ${verifiedSource.sourcePublishedDate}`,
    `Source summary: ${verifiedSource.sourceSummary}`,
    `Selected angle: ${articleAngle.editorialAngle}`,
    `Proposed title: ${articleAngle.proposedTitle}`,
    `Reader value: ${articleAngle.readerValue}`,
    `Key source facts to use: ${articleAngle.keySourceFacts.join(' | ')}`,
    `Do not claim: ${articleAngle.doNotClaim.join(' | ') || 'Do not claim anything not in the source.'}`,
    `Existing titles that must not be repeated: ${params.existingTitles.join('; ') || 'none'}`,
  ].join('\n')) as unknown as {
    finalOutput?: z.infer<typeof ArticleDraftSchema>;
    output?: z.infer<typeof ArticleDraftSchema>;
  };

  const draft = writerResult.finalOutput ?? writerResult.output;
  const title = sanitizeAgentText(draft?.title ?? '');
  const summary = sanitizeAgentText(draft?.summary ?? '');
  const contentMarkdown = sanitizeAgentText(draft?.contentMarkdown ?? '');
  if (!draft || !title || !summary || !contentMarkdown || hasSubjectOverlap(title, params.existingTitles)) return null;

  const editorAgent = new Agent({
    name: 'Newsletter Article Editor/Quality Gate Agent',
    instructions: [
      params.briefPrompt,
      '',
      'You are the final quality gate for the article pipeline.',
      'Approve only if the article is source-backed, specific, useful because of this co-op\'s goals, in the house tone, and not a generic co-op explainer.',
      'Reject if the article could apply to almost any co-op, repeats a prior subject, lacks concrete source facts, invents facts, sounds like marketing copy, or mostly gives broad advice.',
      'You may lightly revise the draft before approval, but keep claims tied to the verified source and co-op context.',
      'If approved, return the final publishable title, summary, and markdown. If rejected, approved must be false and rejectionReason must explain why.',
    ].join('\n'),
    model,
    outputType: ArticleQualityGateSchema,
    tools: [webSearchTool()],
    modelSettings: { toolChoice: 'auto' },
  });

  const editorResult = await run(editorAgent, [
    `Co-op: ${params.coopName}`,
    `Co-op context: ${firstSentence(params.coopDescription) || params.coopName}`,
    `Goals that define usefulness: ${params.missionGoals.join(', ') || 'member ownership, local economic power, community participation'}`,
    `Existing titles that must not be repeated: ${params.existingTitles.join('; ') || 'none'}`,
    '',
    'Verified source:',
    `Source title: ${verifiedSource.sourceTitle}`,
    `Source URL: ${verifiedSource.sourceUrl}`,
    `Source name: ${verifiedSource.sourceName}`,
    `Source date/usefulness: ${verifiedSource.sourcePublishedDate}`,
    `Verified facts: ${verifiedSource.factualSubstance.join(' | ')}`,
    `Goal fit: ${verifiedSource.goalFit}`,
    '',
    'Selected angle:',
    `Title: ${articleAngle.proposedTitle}`,
    `Angle: ${articleAngle.editorialAngle}`,
    `Reader value: ${articleAngle.readerValue}`,
    `Do not claim: ${articleAngle.doNotClaim.join(' | ') || 'Do not claim anything not in the source.'}`,
    '',
    'Draft to review:',
    `Title: ${title}`,
    `Summary: ${summary}`,
    `Markdown:\n${contentMarkdown}`,
  ].join('\n')) as unknown as {
    finalOutput?: z.infer<typeof ArticleQualityGateSchema>;
    output?: z.infer<typeof ArticleQualityGateSchema>;
  };

  const review = editorResult.finalOutput ?? editorResult.output;
  if (!review?.approved) return null;
  const finalTitle = sanitizeAgentText(review.finalTitle || title);
  const finalSummary = sanitizeAgentText(review.finalSummary || summary);
  const finalContentMarkdown = sanitizeAgentText(review.finalContentMarkdown || contentMarkdown);
  if (
    !hasConcreteValue(finalTitle) ||
    !hasConcreteValue(finalSummary) ||
    !hasConcreteValue(finalContentMarkdown) ||
    finalContentMarkdown.length < 500 ||
    hasSubjectOverlap(finalTitle, params.existingTitles)
  ) {
    return null;
  }

  return {
    title: finalTitle.slice(0, 120),
    summary: finalSummary.slice(0, 2000),
    contentMarkdown: clampArticleMarkdown(finalContentMarkdown),
    ctaLabel: sanitizeAgentText(review.ctaLabel ?? draft.ctaLabel ?? '').slice(0, 60) || undefined,
    sourceUrl: verifiedSource.sourceUrl,
    sourceTitle: verifiedSource.sourceTitle.slice(0, 180),
    sourceName: verifiedSource.sourceName.slice(0, 120),
    reasonForFit: `${verifiedSource.goalFit} ${articleAngle.readerValue}`.trim().slice(0, 1000),
  };
}
