import { z } from 'zod'
import type { RuleSettings } from '@/lib/rules'

/**
 * The house rules, as something both the server and a phone can read.
 *
 * One definition drives three things that must never disagree: what the API
 * accepts, what the settings screen offers, and what each choice actually
 * means in words. Writing the options out three times is how a room ends up
 * with a setting the server rejects or a label that describes the wrong rule.
 *
 * `allowRepeatSongs` is absent on purpose. The rules engine pins it to `false`
 * and the same song cannot appear twice, so there is nothing here to offer.
 */

/** Wait this many picks before the same artist is allowed again. */
export const ARTIST_COOLDOWN_MAX = 10

/** A turn timer this long is indistinguishable from none, and 0 means off. */
export const TURN_TIMER_MAX_SECONDS = 600

export const SettingsPatchSchema = z
  .object({
    matchScope: z.enum(['title', 'titleAndArtist']),
    artistCooldown: z.number().int().min(0).max(ARTIST_COOLDOWN_MAX),
    stopwords: z.enum(['ignore', 'allow']),
    looseForms: z.enum(['on', 'off']),
    numerals: z.enum(['strict', 'loose']),
    wordReuse: z.enum(['free', 'noConsecutive', 'burnOnce']),
    turnTimer: z.number().int().min(0).max(TURN_TIMER_MAX_SECONDS),
  })
  .partial()
  // An empty patch is a no-op that would still broadcast to every phone in the
  // car, so it is a bad request rather than a silent success.
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'no settings to change',
  })

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

/** Which settings this screen exposes. Order is the order they are shown. */
export const EDITABLE_SETTINGS = [
  'matchScope',
  'wordReuse',
  'stopwords',
  'looseForms',
  'numerals',
  'artistCooldown',
  'turnTimer',
] as const satisfies ReadonlyArray<keyof RuleSettings>

export type EditableSetting = (typeof EDITABLE_SETTINGS)[number]

export type SettingChoice = {
  value: string | number
  /** On the button. Short enough to read at a glance in a moving car. */
  label: string
}

export type SettingSpec = {
  key: EditableSetting
  title: string
  /** What the rule does, in the words someone would use out loud. */
  hint: string
  choices: readonly SettingChoice[]
}

/**
 * Copy is deliberately concrete. "Loose numerals" means nothing to a passenger;
 * "4 counts as four" is the whole rule in four words, and nobody has to ask.
 */
export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: 'matchScope',
    title: 'Where the word can come from',
    hint: 'Artist names give everyone a lot more to work with when the chain gets stuck.',
    choices: [
      { value: 'title', label: 'Song titles' },
      { value: 'titleAndArtist', label: 'Titles and artists' },
    ],
  },
  {
    key: 'wordReuse',
    title: 'Reusing a word',
    hint: 'Burning each word makes the chain get hard fast. Free keeps it going all trip.',
    choices: [
      { value: 'free', label: 'As often as you like' },
      { value: 'noConsecutive', label: 'Not twice in a row' },
      { value: 'burnOnce', label: 'Once each, then spent' },
    ],
  },
  {
    key: 'stopwords',
    title: 'Little words',
    hint: 'Whether "the", "a" and "of" are enough to link two songs. Allowing them makes it much easier.',
    choices: [
      { value: 'ignore', label: "Don't count" },
      { value: 'allow', label: 'Count' },
    ],
  },
  {
    key: 'looseForms',
    title: 'Word endings',
    hint: "Close enough lets drivin' link to driving, and run to running.",
    choices: [
      { value: 'on', label: 'Close enough' },
      { value: 'off', label: 'Exact words' },
    ],
  },
  {
    key: 'numerals',
    title: 'Numbers',
    hint: 'Whether 4 counts as four.',
    choices: [
      { value: 'strict', label: '4 is not four' },
      { value: 'loose', label: '4 counts as four' },
    ],
  },
  {
    key: 'artistCooldown',
    title: 'Same artist again',
    hint: 'Stops one person working through a whole discography.',
    choices: [
      { value: 0, label: 'Any time' },
      { value: 1, label: 'After 1 song' },
      { value: 2, label: 'After 2' },
      { value: 3, label: 'After 3' },
    ],
  },
  {
    key: 'turnTimer',
    title: 'Turn timer',
    hint: 'Runs out and the turn passes on. Off suits a long drive; a timer suits a competitive one.',
    choices: [
      { value: 0, label: 'No timer' },
      { value: 30, label: '30 sec' },
      { value: 60, label: '1 min' },
      { value: 120, label: '2 min' },
    ],
  },
]
