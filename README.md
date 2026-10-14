# Wyrmhodl

*When the sky broke, alpha fell like rain.*

Wyrmhodl is a sky-realm of floating isles above a sea of cloud. Bind a soulstone, swear to a coven, seek your isle and hatch your Elder Wyrm. Delve wildroot from your isle's marrow and brew it into **alpha**, the first light: it wakes your springs, calls beasts out of the circle, and once brewed can never be stolen. Then read the sky, ride out, and take what other wardens leave unbrewed.

Every warden you meet is a real player, and every rite you speak is sealed with your own soulstone and written into the ledger.

## Play

```bash
pnpm install
pnpm dev        # http://localhost:5191
```

Or in a container, which serves the built game on one port:

```bash
docker build -t wyrmhold .
docker run --rm -p 8080:8080 wyrmhold     # http://localhost:8080
```

A first visit begins with **the Prologue**. Then **Ysolde**, a grey owl spirit, walks you along **the Warden's Path**: twelve steps from soulstone to first strike, each lit by what you have truly done in the sky, with *Show me* to make the right control glow.

| Where | What |
|---|---|
| The Gate | the tale, the oath, wardens abroad |
| The Hold | your isle, your beasts and hallows, your rites and chants |
| Bestiary | every beast and hallow on the summoning dais |
| Sky Atlas | every warden's isle, around their coven's crystal |
| Leyweave | the wellsprings, your shrine, your tithes |
| Skirmish | ride out, mark, unleash, plunder |
| Grimoire | the old tale, the rites, the laws of war |

Your soulstone stays sealed in your browser. Wyrmhodl only ever asks it to set its seal on a rite.

## For builders

How Wyrmhodl binds to the network it plays on, where its engine came from, and how to run it against a private chain: `../wyrmhold-forge/BUILDERS.md`, kept beside this folder.
