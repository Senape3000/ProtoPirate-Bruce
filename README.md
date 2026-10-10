# ProtoPirate for Bruce

JavaScript RF capture and receive decoding for Bruce devices with a CC1101.

## Receive support

| Decoder | Receive preset | Status |
| --- | --- | --- |
| Kia V0 | FM476 / `2FSKDev476Async` | Existing decoder and CRC check |
| Chrysler V0 | AM650 or AM270 | New 80-bit structural decoder, receive only |
| Other protocol names in the source | — | Placeholder functions return `null` |

Chrysler results expose the 80-bit frame and button. Serial number and counter
remain unknown; the structural check is not a CRC or cryptographic validation.
This is not full parity with the native Flipper ProtoPirate application.
Hardware validation of this receive patch is still pending.

## Install and use

1. Use Bruce firmware with `subghz.readRaw(timeoutSeconds, rxPreset)` support and
   the `Bruce_RX_Preset` capture metadata. Older firmware silently ignores the
   second argument; this app detects that and displays an upgrade message.
2. Copy `ProtoPirate.js` to the SD card and open it in Bruce's JS Interpreter.
3. Choose **Set Frequency** and **Receive Preset**, then **Receive Signal**.
4. Turn the encoder to navigate, click to select, and use Back to exit.

The four selectable profiles are AM650, AM270, FM476, and FM238. Selection applies
actual receiver settings through the firmware API. FM238 is available for RAW
capture; no decoder currently uses it. The menu scrolls on small displays.

**Sub Decode** imports `.sub` files. All `RAW_Data` / `Data_RAW` lines are read,
including short pulses and long framing gaps. Known preset aliases are adopted;
unknown/custom presets are preserved when saved and are not guessed for decoding.
**Save** preserves frequency, receive settings, custom preset fields and Bruce
capture metadata, with at most 512 durations on each RAW line. History restores
the capture and its receive settings together. A `Bruce_Buffer_Full: 1` field
means the firmware's capture buffer filled and the capture may be incomplete.

The existing transmit implementation is not extended by this patch. The new
Chrysler decoder is receive only. Timing Analyzer remains a work in progress.

## Regression checks

Run with Node.js:

```sh
node --check ProtoPirate.js
node receive.test.cjs
```

Tests use synthetic data and mocked Bruce APIs. They cover preset confirmation,
multi-line RAW parsing, timing preservation, malformed input and size bounds,
save/import/history metadata, and valid/truncated/malformed Chrysler frames.
They do not transmit or establish hardware compatibility.

## Credits

### Original ProtoPirate
- RocketGod, MMX, Leeroy, gullradriel
- The Pirates' Plunder community

### Protocol Research
- L0rdDiakon, YougZ, DoobTheGoober
- Skorp, Slackware, Trikk, Li0ard

### Bruce Firmware
- @pr3y, @bmorcelli, @IncursioHack

### JS Port
- Educational adaptation for T-Embed CC1101

## Chrysler decoder attribution

The new receive decoder is adapted from Sor3nt/Flipper-Zero-ESP32-Port PR #119,
commit `4c5e129911607afab93218051f5a4f57a7ac1b06`, with credit to the
ProtoPirate contributors and The Pirates' Plunder. This adaptation is licensed
under GPL-3.0; the license text is in `LICENSE.chrysler`.
