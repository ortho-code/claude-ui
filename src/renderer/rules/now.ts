import type { SectionedView } from './sectioned-view';

/**
 * NOW, the view of what calls you and what is in hand elsewhere (docs/architecture/session-list.md § Now): each session in one section by whether it is your turn, the first below whose query holds.
 * A session that asks for you is in Needs you, since Running leaves out what asks; else one whose claude runs in Running; else one set aside or with reasons that do not ask for you now in Not now; Elsewhere holds the sessions of other projects that ask for you or run, only while one project is on show.
 * `project:current` is the project the view shows, every project while it shows All, so Elsewhere is empty there.
 */
export const NOW = {
  id: 'now',
  name: 'Now',
  shared: '',
  sections: [
    { id: 'running', name: 'Running', query: 'project:current is:running -is:asking', sort: 'project', lines: 'state', empty: 'Nothing running.' },
    { id: 'needs-you', name: 'Needs you', query: 'project:current is:asking', sort: 'strength', lines: 'state', empty: 'Nothing needs you.' },
    { id: 'elsewhere', name: 'Elsewhere', query: '-project:current is:asking OR -project:current is:running', sort: 'asking-then-project', lines: 'compact', empty: 'Nothing elsewhere.', inProject: true },
    { id: 'not-now', name: 'Not now', query: 'project:current is:set-aside OR project:current needs:any', sort: 'due', lines: 'state', empty: 'Nothing set aside or read.' },
  ],
} as const satisfies SectionedView;

/** The section whose rows Now counts on its panel's icon and beside its title: what asks for you in what it shows. */
export const NOW_COUNTS = 'needs-you';
