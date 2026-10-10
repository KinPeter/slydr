## Summary
The requested Ken Burns easing and reduced zoom are implemented, but the scale token is shared with crossfade geometry, so the change also alters the transition that the issue explicitly excludes.

## Findings
- MINOR: `client/src/styles/tokens.css:110-118` changes `--kenburns-scale`, while `--slide-out-scale-from` is defined as `var(--kenburns-scale)` and is consumed by the outgoing crossfade in `client/src/screens/Player/SlideImage.module.css:49-52`; reducing the Ken Burns target therefore changes the transition's outgoing scale path as well. Keep the Ken Burns tuning independent from the transition's 1.06 starting scale (and add a regression assertion for that separation) so this improvement does not modify the transition.
