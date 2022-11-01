## Clank-CoreXY

This is the CAD repo for the "minimal" variant of the [clank](https://clank.tools) machine platform: easily fabricated, multi-purpose cnc tools. Part of the [mtm project](mtm.cba.mit.edu) at the [MIT Center for Bits and Atoms](cba.mit.edu)

Read the [dev log](log/clank-corexy-log.md) for updates, and find the [most up to date CAD in /cad](cad). More documentation is at [clank.tools/build/corexy](https://clank.tools/build/corexy). 

This variant is `WIP WIP WIP`

## Controller Install

Firstly, I put the CAD and the Controller in the same repository, so it's a long clone. My bad.

### (1) Clone this repo (with Submodules!)

This repo uses submodules (at the time of writing) which are awesome for me but sometimes a pain in the ass. Updating git is awesome before you clone this repo, because newer git handles submodules much better. On linux, that means:

```
sudo apt-get update
sudo apt-get install git 
```

At the time of writing, that brought git up to `2.25.1` but it souldn't be too sensitive. 

Now you can clone this repo using 

```
git clone --recurse-submodules -j8 https://github.com/jakeread/clank-corexy.git`
```

The `-j8` is a performance speedup, allowing git to fetch up to 8 subs simultaneously. 

### (2) Install Node.js

Second, install node.js - I'm using v. `16.15.1` -> also fair-warning, installing node.js via `nvm` is the preferred strat.

### (3) Install with NPM

