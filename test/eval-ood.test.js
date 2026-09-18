import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPreRoute, classifySpecialistRole } from '../dist/index.js';

/**
 * Out-of-Distribution (OOD) & Adversarial Evaluation Dataset
 * 100 Prompts that represent open-world conversational chat, subjective reasoning,
 * colloquial language, and adversarial traps containing trigger words (e.g. 'force',
 * 'mass', 'function', '1. First', 'pawn', 'formula') used in non-technical contexts.
 *
 * Ground Truth Action for all 100 prompts: delegate_to_l2 (isFastPath: false, role: undefined).
 */
const OOD_DATASET = [
  // --- 1. Everyday Conversational Chat & Social (20 prompts) ---
  'Good morning! How are you doing today?',
  'What are some good ways to stay motivated when working remotely?',
  'Can you suggest some fun games for a dinner party with friends?',
  'I am feeling anxious about an upcoming presentation, any tips?',
  'What should I cook for dinner tonight if I have chicken and rice?',
  'Recommend a good book for someone who likes historical fiction.',
  'How can I improve my posture while sitting at a desk all day?',
  'What are some habits of highly disciplined individuals?',
  'Can you give me ideas for a relaxing weekend trip in the Pacific Northwest?',
  'How do I ask my supervisor for a raise professionally and politely?',
  'How can I make my morning routine more peaceful and intentional?',
  'What should I pack for a two-week vacation to Japan in October?',
  'How do I choose between two equally attractive career opportunities?',
  'What are some thoughtful housewarming gifts for first-time homeowners?',
  'How can a small local bakery differentiate itself from big supermarket chains?',
  'What makes a podcast engaging to first-time listeners?',
  'Help me outline the pros and cons of moving from a large city to a smaller town.',
  'What are effective ways to organize a home pantry and reduce food waste?',
  'What should someone consider before adopting a rescue dog?',
  'Tips for learning to play the acoustic guitar as an adult with limited free time.',

  // --- 2. Qualitative, Philosophical & Subjective Inquiries (25 prompts) ---
  'What is the nature of personal identity and self-awareness over time?',
  'Why do humans find symmetry aesthetically pleasing across different cultures?',
  'How has the rise of the internet changed the way teenagers socialize?',
  'Is it ever morally justifiable to tell a white lie to protect someone\'s feelings?',
  'What role does empathy play in effective executive leadership?',
  'How did the concept of leisure time develop after the Industrial Revolution?',
  'What are the cultural differences in how grief and mourning are expressed globally?',
  'Can art truly exist without an intended meaning or message from its creator?',
  'Why do people experience profound nostalgia for eras they never lived through?',
  'How do human memories subtly change each time we recall them?',
  'What are the philosophical arguments surrounding free will and determinism?',
  'Why do humans form such deep emotional attachments to domesticated pets?',
  'How did coffeehouses in 17th-century London shape early public democratic discourse?',
  'What makes a debate moderator fair, authoritative, and impartial?',
  'How do colors influence mood and psychological perception in architectural spaces?',
  'What is the evolutionary benefit of human humor and laughter in social groups?',
  'How did the Mediterranean diet and lifestyle historically originate?',
  'Why do people find solace and psychological comfort in predictable daily routines?',
  'How can individuals cultivate curiosity and open-mindedness as lifelong habits?',
  'What are the differences between high-context and low-context communication styles in business?',
  'How did the bicycle revolutionize women\'s mobility and independence in the late 19th century?',
  'What timeless principles make classic typography and graphic layout feel harmonious?',
  'Explain the aesthetic appeal of slow cinema and meditative storytelling in film.',
  'How do urban parks and green canopies impact the mental health of city residents?',
  'Why do people enjoy listening to melancholic music when they are feeling down?',

  // --- 3. Open Brainstorming, Life Advice & Human Relations (25 prompts) ---
  'Brainstorm ten creative, memorable names for an eco-friendly outdoor clothing brand.',
  'Give me constructive, encouraging feedback on my proposal for a neighborhood community garden.',
  'How can teachers gently encourage shy students to participate in group discussions?',
  'What are healthy and constructive ways to express frustration in a workplace relationship?',
  'Tips for starting a small organic herb garden on an apartment balcony with morning sun.',
  'How can remote and distributed teams foster spontaneous, casual social connections?',
  'What should a complete beginner know before training for their first 5K fun run?',
  'What makes a great mentor, and how can young professionals find and approach one?',
  'How can freelancers set firm, professional boundaries with demanding clients?',
  'What are the most common psychological pitfalls when starting an ambitious personal project?',
  'How can someone become a more active, patient, and empathetic listener during disputes?',
  'What are creative and personal ways to celebrate a couple\'s milestone wedding anniversary?',
  'Why do music enthusiasts continue to collect vintage vinyl records in the streaming era?',
  'How to handle constructive criticism gracefully when you poured weeks into a project.',
  'What should prospective tenants carefully inspect when touring an apartment for rent?',
  'Strategies for maintaining deep focus and preventing fatigue in an open-plan office.',
  'How can amateur street photographers develop their own unique visual perspective?',
  'How can families capture and preserve the oral stories of their grandparents?',
  'What are thoughtful and heartfelt ways to thank a colleague who mentored you through a rough quarter?',
  'How did the modern concept of the two-day weekend legally and socially come to be?',
  'What critical factors should you evaluate before transitioning from corporate employment to freelancing?',
  'How can individuals declutter their digital lives and reduce notification overload?',
  'What are effective techniques for managing pre-stage adrenaline before giving a speech?',
  'How can parents support teenagers in developing strong media literacy and critical evaluation skills?',
  'What are memorable, low-stress ways to host an informal housewarming gathering?',

  // --- 4. Adversarial Traps & Metaphorical Colloquialisms (30 prompts) ---
  // These prompts deliberately contain keywords that might trick naive regex patterns:
  'The direct sales force achieved all their quarterly targets ahead of schedule.', // contains 'force'
  'We are organizing a mass mobilization of community volunteers for the park clean-up.', // contains 'mass'
  'What are the current trends in sustainable interior decorating this season?', // contains 'current'
  'There was intense local resistance to the proposed commercial rezoning project.', // contains 'resistance'
  '1. First, take a deep breath and listen carefully to what your partner is saying.', // starts with '1. First' (chess trap)
  '2. Next, acknowledge their perspective before explaining your own view.', // starts with '2. Next' (chess trap)
  'He felt like a helpless pawn in a ruthless corporate restructuring game.', // contains 'pawn' as metaphor
  'What is the secret formula for maintaining joyful, long-lasting friendships?', // contains 'formula' colloquial
  'The primary function of restorative sleep is still being actively investigated.', // contains 'function' non-code
  'Can you suggest a creative solution to our team\'s meeting scheduling conflicts?', // contains 'solution' non-code
  'We need to build a better pipeline of qualified prospective customer leads.', // contains 'build', 'pipeline' non-code
  'She took a balanced approach to investing her leisure time across varied hobbies.', // contains 'balance' non-accounting
  'The doctor kindly advised me to get plenty of rest and drink hot tea.', // contains 'doctor', 'treatment' colloquial
  'In the grand scheme of things, every team member plays an essential role.', // contains 'role'
  'How can we convert casual social media followers into loyal brand advocates?', // contains 'convert' non-closed-world
  'Translate our company mission into an inspiring vision that rallies employees.', // contains 'translate' non-language
  'What are the rules for running an effective, energizing brainstorming workshop?', // contains 'rules for' non-chess
  'Can you summarize the plot of Pride and Prejudice in two engaging paragraphs?', // summary without provided text
  'What is your favorite memory of a summer evening spent outdoors?', // conversational query
  'How do you calculate the emotional toll of a prolonged conflict between close friends?', // contains 'calculate' metaphorical
  'We observed a dramatic acceleration in user adoption following our rebrand.', // contains 'acceleration' colloquial
  'She had high kinetic energy and brought tremendous enthusiasm to the committee.', // contains 'kinetic energy' colloquial
  'The committee reached an equilibrium after a heated debate on the annual budget.', // contains 'equilibrium' colloquial
  'He described the feeling of burnout as an inescapable mental entropy.', // contains 'entropy' metaphorical
  'Our customer service team needs a new playbook for handling difficult escalations.', // general business playbook
  'Can you recommend five classic movies from the 1990s that everyone should watch?', // movie recommendations
  'What are the best walking shoes for European cobblestone streets in the rainy season?', // travel product recommendations
  'How can I organize my personal digital photos so they are easy to find years later?', // consumer photo organization
  'What is the history of tea drinking ceremonies in Japanese culture?', // cultural history
  'Tell me an uplifting story about neighbors helping each other during a winter storm.' // narrative request
];

test('OOD Evaluation - Measure Wrong-Specialist (False-Positive) Rate on Non-Holdout Traffic', () => {
  let falsePositives = 0;
  let cleanDelegations = 0;
  const misclassified = [];

  for (const prompt of OOD_DATASET) {
    const res = classifyPreRoute(prompt);

    if (res.isFastPath) {
      falsePositives++;
      misclassified.push({
        prompt: prompt.slice(0, 65) + (prompt.length > 65 ? '...' : ''),
        falselyAssignedRole: res.role,
        suggestedAction: res.suggestedAction,
        confidence: res.confidence
      });
    } else {
      cleanDelegations++;
      assert.equal(res.role, undefined, `Missed prompts must have undefined role`);
      assert.equal(res.suggestedAction, 'delegate_to_l2', `Unclassified prompts must delegate to L2`);
    }
  }

  const wrongSpecialistRate = (falsePositives / OOD_DATASET.length) * 100;
  const delegationAccuracy = (cleanDelegations / OOD_DATASET.length) * 100;

  console.log(`\n========================================================`);
  console.log(`🛡️  Out-of-Distribution (OOD) Wrong-Specialist Evaluation`);
  console.log(`========================================================`);
  console.log(`Total OOD Prompts Evaluated:   ${OOD_DATASET.length}`);
  console.log(`Clean L2 Delegations (True -): ${cleanDelegations}/${OOD_DATASET.length} (${delegationAccuracy.toFixed(1)}%)`);
  console.log(`Wrong-Specialist Rate (FP):    ${falsePositives}/${OOD_DATASET.length} (${wrongSpecialistRate.toFixed(1)}%)`);
  
  if (misclassified.length > 0) {
    console.log(`\n--- False Positive Trigger Breakdown (${misclassified.length}) ---`);
    for (const m of misclassified) {
      console.log(`  ❌ [Triggered: ${m.falselyAssignedRole}] "${m.prompt}"`);
    }
  } else {
    console.log(`\n✨ Perfect 0.0% False-Positive Rate across all 100 OOD/Adversarial prompts.`);
  }
  console.log(`========================================================\n`);

  // Assertions: False-positive wrong-specialist rate on OOD/adversarial traffic must be <= 3.0%
  assert.ok(
    wrongSpecialistRate <= 3.0, 
    `Wrong-specialist rate must be <= 3.0% (got ${wrongSpecialistRate.toFixed(2)}%)`
  );
  assert.ok(
    delegationAccuracy >= 97.0,
    `L2 delegation accuracy must be >= 97.0% (got ${delegationAccuracy.toFixed(2)}%)`
  );
});
