/** THE LONG GAME — the campaign's eight opponents.
 *
 * Each chapter is an AI difficulty, a set of augments, a horror level and a
 * voice. The opponents are the same search engine throughout; what changes is
 * what they are allowed to do and what they say while doing it. The horror
 * escalation is deliberately gradual — nothing announces itself until the
 * middle chapters, by which point the palette has already been sliding for a
 * while.
 */

import type { DifficultyKey } from '../ui/ai-match';
import type { AugmentId, Color } from '../engine/types';

export interface Chapter {
  id: string;
  /** Roman numeral shown on the chapter card. */
  numeral: string;
  name: string;
  /** One line under the name on the select screen. */
  title: string;
  /** Single glyph used as the speaker's portrait. */
  glyph: string;
  difficulty: DifficultyKey;
  /** What this opponent plays with. The player always plays clean. */
  augments: ReadonlyArray<AugmentId>;
  /** 0..7, drives `setHorror`. */
  horror: number;
  playerColor: Color;
  /** Spoken before the board appears. */
  intro: ReadonlyArray<string>;
  /** Occasional lines while playing, picked at random after a capture. */
  taunts: ReadonlyArray<string>;
  /** After the player wins. */
  onDefeat: ReadonlyArray<string>;
  /** After the player loses. */
  onVictory: ReadonlyArray<string>;
}

export const CHAPTERS: ReadonlyArray<Chapter> = [
  {
    id: 'margo',
    numeral: 'I',
    name: 'MARGO PELL',
    title: 'The greeter',
    glyph: '☕',
    difficulty: 'easy',
    augments: [],
    horror: 0,
    playerColor: 'w',
    intro: [
      'Oh — a new face. Sit down, sit down, the kettle just went.',
      'Cheskers is simple enough. Your front row hops like draughts. Your back row thinks like chess.',
      'No check, no checkmate. You take the king, or they take yours. That is the whole of it.',
      'Everyone plays me first. House rule.',
    ],
    taunts: [
      'Oh, good one. Genuinely.',
      'Mm. I would not have gone there, but you might be right.',
      'You are picking this up quickly.',
    ],
    onDefeat: [
      'Well! Not bad at all.',
      'Sign the book on your way through — Mr Tallow likes to know who is playing.',
      'It is only a formality. Everyone signs.',
    ],
    onVictory: [
      'Ah, never mind. You will get it.',
      'Have another go. There is no rush here.',
      'There is really no rush here at all.',
    ],
  },

  {
    id: 'dev',
    numeral: 'II',
    name: 'DEV ARANHA',
    title: 'Two minutes flat',
    glyph: '⏱',
    difficulty: 'easy',
    augments: ['flank'],
    horror: 0,
    playerColor: 'w',
    intro: [
      'You are the new one. Margo let you through, then.',
      'I do this in under two minutes usually. No offence. It is just a thing I do.',
      'My checkers go sideways, by the way. Everyone here plays a bit different.',
      'You pick things up. Eventually.',
    ],
    taunts: [
      'Okay. Okay, that was fine.',
      'You are slower than me but you are not wrong.',
      'Hm. Do that again and I will start trying.',
    ],
    onDefeat: [
      'That was more than two minutes.',
      'That was — how long have we been sitting here?',
      'Doesn’t matter. Go on. Archivist is through the back.',
    ],
    onVictory: [
      'Two minutes. Told you.',
      'Play me again, it is not like the day is going anywhere.',
    ],
  },

  {
    id: 'archivist',
    numeral: 'III',
    name: 'THE ARCHIVIST',
    title: 'Keeper of the book',
    glyph: '📖',
    difficulty: 'medium',
    augments: ['early_crown'],
    horror: 1,
    playerColor: 'w',
    intro: [
      'You signed. Good. I have you here.',
      'Every game played in this room is written down. Openings, blunders, how long each player lasted.',
      'It is a thorough record. I have been keeping it a long time.',
      '…Your entry is dated before you walked in. That happens sometimes. I would not dwell on it.',
    ],
    taunts: [
      'That line is on page four hundred. It did not work then either.',
      'Interesting. I will need a new page for you.',
      'Others have tried that. I have their names.',
    ],
    onDefeat: [
      'Noted. Amended. You are the first in some while.',
      'I will need to check whether the book allows that.',
      'Go through. Twelve is waiting, though Twelve is always waiting.',
    ],
    onVictory: [
      'As written.',
      'Do not look so put out. It was always going to be written down either way.',
    ],
  },

  {
    id: 'twelve',
    numeral: 'IV',
    name: 'PATIENT TWELVE',
    title: 'Does not remember arriving',
    glyph: '🩹',
    difficulty: 'medium',
    augments: ['undying', 'backpedal'],
    horror: 2,
    playerColor: 'w',
    intro: [
      'Hello. Have we played before? You look like we have played before.',
      'I cannot remember coming in. There is a band on my wrist with a number on it and I do not remember that either.',
      'My pieces come back. Once each. I do not know why mine do that and yours do not.',
      'I would like to stop. I keep sitting down.',
    ],
    taunts: [
      'That is fine. It comes back.',
      'Have we played before?',
      'You are being kind. People stop being kind around chapter six.',
    ],
    onDefeat: [
      'Oh. Oh, that is a relief.',
      'Does that mean I can go? Does that mean I can go now?',
      '…No. All right. All right.',
    ],
    onVictory: [
      'Sorry. Sorry. I do not enjoy it.',
      'Again? We can go again. We can always go again.',
    ],
  },

  {
    id: 'unseated',
    numeral: 'V',
    name: 'THE UNSEATED',
    title: 'Lost, and stayed',
    glyph: '🪑',
    difficulty: 'medium',
    augments: ['relentless', 'backpedal', 'flank'],
    horror: 3,
    playerColor: 'w',
    intro: [
      'Sit.',
      'I lost my game. I did not leave. Those are two separate decisions and only one of them was mine.',
      'When I take, I keep taking. Crowning does not stop me. Nothing stops me.',
      'You are still warm. That is the part I notice now.',
    ],
    taunts: [
      'Warm.',
      'Keep going. I have nothing else.',
      'You still think this ends.',
    ],
    onDefeat: [
      'Then you go on, and I stay.',
      'That is how it works. Someone goes on. Someone stays.',
      'Ask Tallow which one you are.',
    ],
    onVictory: [
      'Sit back down.',
      'You do not get up. Not from this chair. I would know.',
    ],
  },

  {
    id: 'tallow',
    numeral: 'VI',
    name: 'MR. TALLOW',
    title: 'Proprietor',
    glyph: '🕯',
    difficulty: 'hard',
    augments: ['royal_guard', 'siege_rook'],
    horror: 4,
    playerColor: 'w',
    intro: [
      'You have been signed in since the moment you considered coming.',
      'I own the room, the book, the chairs, and a percentage of everyone in them.',
      'My king does not fall to the first hand laid on him. That hand comes off instead.',
      'Do sit. You are already sitting. I only like to say it.',
    ],
    taunts: [
      'Yes. Reach for him. See what it costs.',
      'You are playing well. That is not the same as leaving.',
      'The candles are not decoration. They are a clock.',
    ],
    onDefeat: [
      'Oh, well struck.',
      'You have taken something of mine, so the arrangement adjusts. It always adjusts.',
      'Go and meet the ones who sing. I would rather not be in the room for it.',
    ],
    onVictory: [
      'Wax cools. Games end. You stay.',
      'I will have your entry finished by morning. There is no morning, but I will have it finished.',
    ],
  },

  {
    id: 'choir',
    numeral: 'VII',
    name: 'THE CHOIR',
    title: 'Many players, one board',
    glyph: '👁',
    difficulty: 'hard',
    augments: ['flying_kings', 'bloodcrown', 'zealot_bishop'],
    horror: 5,
    playerColor: 'w',
    intro: [
      'WE HAVE BEEN LOOKING FORWARD TO YOU.',
      'We are everyone who sat down and did not get up. Margo is in here. Dev is in here. You will fit.',
      'Our crowned men do not walk. They travel. Our bishops leap. Our blood crowns itself.',
      'You have been playing our game with our pieces on our board since chapter one. Did you think it was yours?',
    ],
    taunts: [
      'GOOD. MORE.',
      'That was Dev’s move. He is pleased you used it.',
      'You are not playing eight opponents. You never were.',
    ],
    onDefeat: [
      'Oh.',
      'Oh, that is new. We have not been new in a very long time.',
      'Then go to the last board. Sit down opposite. You know who is there.',
    ],
    onVictory: [
      'WELCOME. WELCOME. WELCOME.',
      'You are a voice now. It does not hurt. It only takes the parts that were yours.',
    ],
  },

  {
    id: 'mirror',
    numeral: 'VIII',
    name: 'YOU',
    title: 'The long game',
    glyph: '♟',
    difficulty: 'hard',
    augments: ['royal_guard', 'amazon_queen', 'relentless'],
    horror: 7,
    playerColor: 'w',
    intro: [
      'You know this opening. You have played it in every chapter.',
      'I am the one who walked in. You are the one who kept sitting down.',
      'I have everything you learned and one thing you do not: I already know how this ends.',
      'Take the king. That is all it has ever been. Take the king and one of us leaves.',
    ],
    taunts: [
      'I would have played that.',
      'I did play that. Chapter two. You were watching.',
      'Whichever of us wins, the book says the same name.',
    ],
    onDefeat: [
      'Then you leave.',
      'The door is where it always was, behind the chair you have not stood up from.',
      'Stand up.',
      '…Well done. Genuinely. Margo would be pleased.',
    ],
    onVictory: [
      'Sit. You know how this goes.',
      'You have all the time in the world. More than you would like.',
    ],
  },
];

export function chapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}
