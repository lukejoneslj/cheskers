/** Online play and the AI both take exclusive ownership of the board's
 *  `MatchBinding` -- starting one while the other is mid-match would leave
 *  them fighting over `app.setBinding()`. Each controller calls the other's
 *  `leave()` before it begins its own match. */
export interface MatchPeer {
  leave(): void;
}
