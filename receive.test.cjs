// Synthetic receive-only regression checks. No radio or transmit API is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'ProtoPirate.js'), 'utf8');
let radioResult = '', requestedPreset = '';
const noop = () => 0;
const display = new Proxy({width: () => 170, height: () => 320}, {
    get: (target, name) => target[name] || noop
});
const context = vm.createContext({
    require: name => name === 'subghz' ? {
        readRaw: (seconds, preset) => { assert.equal(seconds, 1); requestedPreset = preset; return radioResult; }
    } : name === 'display' ? display : new Proxy({}, {get: () => noop}),
    delay: noop
});
vm.runInContext(source.slice(0, source.indexOf('// MAIN\n')), context);
const values = value => Array.from(value);
assert.deepEqual(values(context.parseRaw('31 -30000 500 -50')), [31, -30000, 500, -50]);
for (const text of ['0 1', '1 bad -2', '10000001', '--1', '']) {
    assert.equal(context.parseRaw(text).length, 0);
}
assert.equal(context.parseRaw(Array(8193).fill('1').join(' ')).length, 0);
assert.equal(context.extractRawData('RAW_Data: 31 -30000\nData_RAW: 600 -3400\n'), '31 -30000 600 -3400');
const pulses = Array.from({length: 1301}, (_, i) => i % 2 ? -30000 : i + 31);
context.lastRawData = pulses.join(' ');
context.lastCaptureContent = 'Frequency: 315000000\nPreset: FuriHalSubGhzPreset2FSKDev476Async\nBruce_Buffer_Full: 1\n';
assert(context.adoptFilePreset(context.lastCaptureContent));
assert.equal(context.presetName, 'FM476');
const saved = context.savedRawContent();
assert(saved.includes('Frequency: 315000000\nPreset: FuriHalSubGhzPreset2FSKDev476Async\n'));
assert(saved.includes('Bruce_Buffer_Full: 1\n'));
assert.deepEqual(values(context.parseRaw(context.extractRawData(saved))), pulses);
for (const line of saved.split('\n').filter(line => line.startsWith('RAW_Data:'))) {
    assert(line.slice(9).trim().split(/\s+/).length <= 512);
}
context.lastCaptureContent = 'Frequency: 433920000\nPreset: FuriHalSubGhzPresetCustom\nCustom_preset_module: CC1101\nCustom_preset_data: 00 00\n';
assert(!context.adoptFilePreset(context.lastCaptureContent));
assert.equal(context.presetName, 'Unknown RX');
assert(context.savedRawContent().includes('Custom_preset_data: 00 00\n'));
assert.equal(context.tryDecode([300, -3400]), null);

// Synthetic 80-bit Chrysler structural frame, not a captured remote credential.
function frame(bytes) {
    const durations = Array.from({length: 16}, () => [300, -3400]).flat();
    durations.push(300, -9000);
    for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) durations.push(byte & (1 << bit) ? 600 : 300, -3400);
    return durations;
}
const bytes = [0x80, 0x12, 0, 0, 0x34, 0x12, 0x70, 0, 0, 0x24];
const result = context.decodeChrysler(frame(bytes));
assert(result && result.receiveOnly && result.fieldsUnknown);
assert.equal(result.bits, 80);
assert.equal(result.rawHex, '80120000341270000024');
assert.equal(result.btnName, 'Unlock');
assert.equal(context.decodeChrysler(frame(bytes).slice(0, -2)), null);
const broken = [...bytes]; broken[5] ^= 1;
assert.equal(context.decodeChrysler(frame(broken)), null);
context.presetName = 'FM238';
assert.equal(context.tryDecode(frame(bytes)), null);
context.presetName = 'AM650';
assert(context.tryDecode(frame(bytes)));
context.historyAdd(result, context.lastRawData);
assert.equal(context.history[0].content, context.lastCaptureContent);

context.presetIndex = 2;
radioResult = 'Protocol: RAW\nRAW_Data: 100 -100\n';
assert.equal(context.readCapture(), '');
assert.equal(context.appState, 'menu');
radioResult = 'Bruce_RX_Preset: 2FSKDev476Async\nRAW_Data: 100 -100\n';
assert.equal(context.readCapture(), radioResult);
assert.equal(requestedPreset, '2FSKDev476Async');
assert.equal(context.presetName, 'FM476');
console.log('PASS: preset validation, multi-line RAW, gaps, save/import/history, Chrysler structure and truncation');
