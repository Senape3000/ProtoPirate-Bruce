/**
 * ProtoPirate Car Key Decoder for Bruce Firmware 2.0+
 * Receive preset and RAW preservation fixes.
 * Requires patched Bruce for subghz.readRaw(timeout, preset).
 * Receive decoders: Kia V0 (existing), Chrysler V0 (added, receive-only).
 * Chrysler framing adapted from Sor3nt PR #119, commit
 * 4c5e129911607afab93218051f5a4f57a7ac1b06 (GPL-3.0).
 * Hardware validation pending. This is not full ProtoPirate 3.6.3 parity.
 * Converted from Flipper Zero C application
 */

var display = require('display');
var keyboardApi = require('keyboard');
var subghz = require('subghz');
var storage = require('storage');

// Get function references (Bruce pattern - CRITICAL for button handling)
var width = display.width;
var height = display.height;
var color = display.color;
var drawFillRect = display.drawFillRect;
var drawRect = display.drawRect;
var drawString = display.drawString;
var setTextColor = display.setTextColor;
var setTextSize = display.setTextSize;

var getPrevPress = keyboardApi.getPrevPress;
var getNextPress = keyboardApi.getNextPress;
var getSelPress = keyboardApi.getSelPress;
var getEscPress = keyboardApi.getEscPress;
var setLongPress = keyboardApi.setLongPress;

// Screen
var screenWidth = width();
var screenHeight = height();

// Colors
var BLACK = color(0, 0, 0);
var WHITE = color(255, 255, 255);
var GREEN = color(0, 200, 0);
var RED = color(200, 0, 0);
var CYAN = color(0, 200, 200);
var YELLOW = color(200, 200, 0);
var GRAY = color(80, 80, 80);
var ORANGE = color(200, 100, 0);

// ============================================================================
// APPLICATION STATE
// ============================================================================

var menuIndex = 0;
var menuItems = [
    "Receive Signal",
    "Sub Decode (Load .sub)",
    "Signal History",
    "Timing Analyzer",
    "Set Frequency",
    "Receive Preset",
    "Protocol Info",
    "Exit"
];
var appState = "menu";
var lastResult = null;
var lastRawData = "";
var lastCaptureContent = "";
var frequency = 433.92;
var freqOptions = [315.0, 433.92, 868.35];
var freqIndex = 1;
var resultMenuIndex = 0;
var loadFileIndex = 0;
var loadedFiles = [];
var history = [];
var historyIndex = 0;
var saveCounter = 0;
var HISTORY_MAX = 20;
var presetName = "AM650";
var presetIndex = 0;
var presetLabels = ["AM650", "AM270", "FM476", "FM238"];
var presetValues = ["Ook650Async", "Ook270Async", "2FSKDev476Async", "2FSKDev238Async"];
function selectedPreset() { return presetValues[presetIndex]; }
function readCapture() {
    presetName = presetLabels[presetIndex];
    var content = subghz.readRaw(1, selectedPreset());
    if (content && content.length > 10) {
        // Old firmware ignores argument #2. Never pretend it applied FM.
        if (content.indexOf("Bruce_RX_Preset: " + selectedPreset()) < 0) {
            drawMessage("Needs RF capture firmware\nRX preset was not applied", RED);
            delay(1500);
            appState = "menu";
            setLongPress(false);
            drawMenu();
            return "";
        }
        lastCaptureContent = content;
    }
    return content;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function abs(x) { return x < 0 ? -x : x; }
function durMatch(dur, target, delta) { return abs(dur - target) < delta; }

function toHex(n, d) {
    var h = n.toString(16).toUpperCase();
    while (h.length < d) h = "0" + h;
    return h;
}

function clearScreen() { 
    drawFillRect(0, 0, screenWidth, screenHeight, BLACK); 
}

function drawMessage(msg, col) {
    clearScreen();
    setTextSize(1); 
    setTextColor(col);
    drawString(msg, 10, screenHeight / 2 - 10);
}

function drawStatusBar() {
    setTextSize(1);
    setTextColor(WHITE);
    drawString(frequency + " MHz", 2, 2);
    drawString(presetName, screenWidth - 50, 2);
}

// CRC8 for Kia V0
function kiaCrc8(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
        crc = crc ^ bytes[i];
        for (var j = 0; j < 8; j++) {
            if ((crc & 0x80) !== 0) {
                crc = ((crc << 1) ^ 0x7F) & 0xFF;
            } else {
                crc = (crc << 1) & 0xFF;
            }
        }
    }
    return crc;
}

function getButtonName(proto, btn) {
    if (proto.indexOf("Kia") >= 0) {
        if (btn === 1) return "Lock";
        if (btn === 2) return "Unlock";
        if (btn === 3) return "Trunk";
        if (btn === 4) return "Panic";
    } else if (proto.indexOf("Ford") >= 0) {
        if (btn === 1) return "Lock";
        if (btn === 2) return "Unlock";
        if (btn === 4) return "Boot";
    } else if (proto.indexOf("Subaru") >= 0) {
        if (btn === 1) return "Lock";
        if (btn === 2) return "Unlock";
        if (btn === 4) return "Trunk";
        if (btn === 8) return "Panic";
    } else if (proto.indexOf("Fiat") >= 0) {
        if (btn === 1) return "Unlock";
        if (btn === 2) return "Lock";
        if (btn === 4) return "Boot";
    } else if (proto.indexOf("Chrysler") >= 0) {
        if (btn === 1) return "Lock";
        if (btn === 2) return "Unlock";
        if (btn === 4) return "Trunk";
        if (btn === 8) return "Panic";
    }
    return "Btn:" + toHex(btn, 2);
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

function historyAdd(result, rawData) {
    if (history.length >= HISTORY_MAX) {
        history.shift();
    }
    history.push({
        result: result,
        rawData: rawData,
        frequency: frequency,
        preset: presetName,
        presetIndex: presetIndex,
        content: lastCaptureContent
    });
    return true;
}

function historyGetTextItem(idx) {
    if (idx >= history.length) return "---";
    var item = history[idx];
    return (idx + 1) + ". " + item.result.proto + " " + item.result.btnName;
}

function historyGetFullItem(idx) {
    if (idx >= history.length) return "---";
    var item = history[idx];
    var r = item.result;
    var text = "Protocol: " + r.proto + "\n";
    text += "Bits: " + r.bits + "\n";
    text += "Serial: " + (r.receiveOnly ? "Unknown" : toHex(r.serial, 7)) + "\n";
    text += "Button: " + r.btnName + "\n";
    text += "Counter: " + (r.receiveOnly ? "Unknown" : "0x" + toHex(r.counter, 4)) + "\n";
    text += (r.receiveOnly ? "Structure: " : "CRC: ") + (r.crcOk ? "OK" : "FAIL") + "\n";
    text += "Freq: " + item.frequency + " MHz";
    return text;
}

// ============================================================================
// PROTOCOL CONSTANTS
// ============================================================================

var PROTO_KIA_V0 = { name: "Kia V0", te_short: 250, te_long: 500, te_delta: 100, min_bits: 61 };
var PROTO_KIA_V1 = { name: "Kia V1", te_short: 800, te_long: 1600, te_delta: 200, min_bits: 57 };
var PROTO_KIA_V2 = { name: "Kia V2", te_short: 500, te_long: 1000, te_delta: 150, min_bits: 53 };
var PROTO_FORD = { name: "Ford V0", te_short: 250, te_long: 500, te_delta: 100, min_bits: 64 };
var PROTO_SUZUKI = { name: "Suzuki", te_short: 250, te_long: 500, te_delta: 100, min_bits: 64 };
var PROTO_STARLINE = { name: "StarLine", te_short: 250, te_long: 500, te_delta: 120, min_bits: 64 };
var PROTO_SCHERKHAN = { name: "Scher-Khan", te_short: 750, te_long: 1100, te_delta: 160, min_bits: 35 };
var PROTO_SUBARU = { name: "Subaru", te_short: 800, te_long: 1600, te_delta: 200, min_bits: 64 };
var PROTO_FIAT = { name: "Fiat V0", te_short: 200, te_long: 400, te_delta: 100, min_bits: 64 };
var PROTO_CHRYSLER = { name: "Chrysler", te_short: 200, te_long: 400, te_delta: 120, min_bits: 64 };

// ============================================================================
// DECODERS (Simplified for brevity - include all from previous version)
// ============================================================================

function decodeKiaV0(pulses) {
    var p = PROTO_KIA_V0;
    var step = 0, headerCount = 0, teLast = 0, dataHi = 0, dataLo = 0, bitCount = 0;
    for (var i = 0; i < pulses.length; i++) {
        var level = pulses[i] > 0;
        var dur = abs(pulses[i]);
        if (step === 0) {
            if (level && durMatch(dur, p.te_short, p.te_delta)) { step = 1; teLast = dur; headerCount = 0; }
        } else if (step === 1) {
            if (level) { teLast = dur; }
            else {
                if (durMatch(dur, p.te_short, p.te_delta) && durMatch(teLast, p.te_short, p.te_delta)) { headerCount++; }
                else if (durMatch(dur, p.te_long, p.te_delta) && durMatch(teLast, p.te_long, p.te_delta)) {
                    if (headerCount > 15) { step = 2; dataHi = 0; dataLo = 1; bitCount = 1; }
                    else { step = 0; }
                } else { step = 0; }
            }
        } else if (step === 2) {
            if (level) {
                if (dur >= (p.te_long + p.te_delta * 2)) {
                    if (bitCount === p.min_bits) { return extractKiaV0(dataHi, dataLo, bitCount); }
                    step = 0;
                } else { teLast = dur; step = 3; }
            } else { step = 0; }
        } else if (step === 3) {
            if (!level) {
                if (durMatch(teLast, p.te_short, p.te_delta) && durMatch(dur, p.te_short, p.te_delta)) {
                    dataHi = (dataHi << 1) | (dataLo >>> 31); dataLo = (dataLo << 1) >>> 0; bitCount++; step = 2;
                } else if (durMatch(teLast, p.te_long, p.te_delta) && durMatch(dur, p.te_long, p.te_delta)) {
                    dataHi = (dataHi << 1) | (dataLo >>> 31); dataLo = ((dataLo << 1) | 1) >>> 0; bitCount++; step = 2;
                } else { step = 0; }
            } else { step = 0; }
        }
    }
    return null;
}

function extractKiaV0(dataHi, dataLo, bitCount) {
    var serial = ((dataLo >>> 12) & 0x0FFFFFFF);
    var button = (dataLo >>> 8) & 0x0F;
    var counter = ((dataHi << 24) | (dataLo >>> 8)) >>> 16 & 0xFFFF;
    var rxCrc = dataLo & 0xFF;
    var crcBytes = [(dataHi >>> 16) & 0xFF, (dataHi >>> 8) & 0xFF, dataHi & 0xFF, (dataLo >>> 24) & 0xFF, (dataLo >>> 16) & 0xFF, (dataLo >>> 8) & 0xFF];
    var calcCrc = kiaCrc8(crcBytes);
    return { proto: "Kia V0", bits: bitCount, dataHi: dataHi, dataLo: dataLo, serial: serial, button: button, btnName: getButtonName("Kia V0", button), counter: counter, crcOk: (rxCrc === calcCrc) };
}

// [Add all other decoders from previous version here]
function decodeKiaV1(pulses) { return null; }
function extractKiaV1(dataHi, dataLo, bitCount) { return null; }
function decodeKiaV2(pulses) { return null; }
function extractKiaV2(dataHi, dataLo, bitCount) { return null; }
function decodeStarLine(pulses) { return null; }
function extractStarLine(dataHi, dataLo, bitCount) { return null; }
function decodeScherKhan(pulses) { return null; }
function extractScherKhan(dataHi, dataLo, bitCount) { return null; }
function decodeSubaru(pulses) { return null; }
function extractSubaru(dataHi, dataLo, bitCount) { return null; }
function decodeFiatV0(pulses) { return null; }
function extractFiatV0(dataHi, dataLo, bitCount) { return null; }

function extractChrysler(dataHi, dataLo, bitCount) { return null; }
function decodeGenericPWM(pulses, proto) { return null; }

function tryDecode(pulses) {
    if (presetName === "FM476") return decodeKiaV0(pulses);
    if (presetName === "AM650" || presetName === "AM270") return decodeChrysler(pulses);
    return null;
}

// ============================================================================
// RAW DATA PARSING
// ============================================================================

function parseRaw(str) {
    var tokens = str.trim().split(/\s+/);
    var pulses = [];
    for (var i = 0; i < tokens.length; i++) {
        if (!/^[+-]?[0-9]+$/.test(tokens[i])) return [];
        var value = parseInt(tokens[i], 10);
        if (!value || abs(value) > 10000000 || pulses.length >= 8192) return [];
        // Gaps and short pulses are part of framing. Preserve them verbatim.
        pulses.push(value);
    }
    return pulses;
}
function extractRawData(content) {
    var lines = content.split("\n"), parts = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("RAW_Data:") === 0 || line.indexOf("Data_RAW:") === 0)
            parts.push(line.substring(line.indexOf(":") + 1).trim());
    }
    return parts.length ? parts.join(" ") : null;
}
function savedRawContent() {
    // Keep receive settings and metadata from the original capture, including
    // imported presets. Only rebuild RAW_Data to the standard 512-value limit.
    var lines = lastCaptureContent.split("\n"), meta = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("Frequency:") === 0 || line.indexOf("Preset:") === 0 ||
            line.indexOf("Custom_preset_") === 0 || line.indexOf("Bruce_") === 0) meta.push(line);
    }
    var content = "Filetype: Flipper SubGhz RAW File\nVersion: 1\n";
    if (!meta.length) meta.push("Frequency: " + Math.round(frequency * 1000000), "Preset: " + selectedPreset());
    content += meta.join("\n") + "\nProtocol: RAW\n";
    var pulses = parseRaw(lastRawData);
    for (var j = 0; j < pulses.length; j += 512)
        content += "RAW_Data: " + pulses.slice(j, j + 512).join(" ") + "\n";
    return content;
}

function extractFrequency(content) {
    var idx = content.indexOf("Frequency:");
    if (idx < 0) return null;
    var start = idx + 10;
    var end = content.indexOf("\n", start);
    if (end < 0) end = content.length;
    var freqStr = content.substring(start, end).trim();
    var freqHz = parseInt(freqStr, 10);
    if (freqHz > 0) { return freqHz / 1000000; }
    return null;
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

function scanForFiles() {
    loadedFiles = [];
    var dirs = ["/", "/BruceRF/", "/subghz/"];
    for (var d = 0; d < dirs.length; d++) {
        try {
            var files = storage.readdir(dirs[d]);
            if (files && files.length) {
                for (var i = 0; i < files.length; i++) {
                    var fname = files[i];
                    if (fname && fname.length > 4) {
                        var ext = fname.substring(fname.length - 4).toLowerCase();
                        if (ext === ".sub") { loadedFiles.push(dirs[d] + fname); }
                    }
                }
            }
        } catch (e) { }
    }
    return loadedFiles.length;
}

function loadAndDecodeFile(filepath) {
    drawMessage("Loading...\n" + filepath, YELLOW);
    try {
        var content = storage.read(filepath);
        if (!content || content.length < 20) { drawMessage("File empty!", RED); delay(1500); return false; }
        lastCaptureContent = content;
        adoptFilePreset(content);
        var fileFreq = extractFrequency(content);
        if (fileFreq) { frequency = fileFreq; subghz.setFrequency(frequency); }
        var rawStr = extractRawData(content);
        if (!rawStr || rawStr.length < 10) { drawMessage("No RAW_Data!", RED); delay(1500); return false; }
        var pulses = parseRaw(rawStr);
        if (pulses.length < 20) { drawMessage("Not enough data!", RED); delay(1500); return false; }
        var result = tryDecode(pulses);
        if (result) {
            lastResult = result; lastRawData = rawStr; resultMenuIndex = 0;
            historyAdd(result, rawStr);
            appState = "result"; drawResult(result); delay(300); return true;
        } else { drawMessage("Could not decode!", RED); delay(1500); return false; }
    } catch (e) { drawMessage("Error reading file!", RED); delay(1500); return false; }
}

function drawLoadMenu() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("Sub Decode", 10, 5); setTextSize(1);
    if (loadedFiles.length === 0) {
        setTextColor(RED); drawString("No .sub files found!", 10, 35); setTextColor(WHITE);
        drawString("Copy .sub files to", 10, 55); drawString("/subghz/ folder", 10, 70);
    } else {
        setTextColor(WHITE); drawString("Found " + loadedFiles.length + " file(s)", 10, 30);
        var y = 50;
        var startIdx = Math.max(0, loadFileIndex - 2);
        var endIdx = Math.min(loadedFiles.length, startIdx + 5);
        for (var i = startIdx; i < endIdx; i++) {
            var fname = loadedFiles[i];
            if (fname.length > 28) { fname = ".." + fname.substring(fname.length - 26); }
            if (i === loadFileIndex) { drawFillRect(5, y - 2, screenWidth - 10, 14, GRAY); setTextColor(CYAN); }
            else { setTextColor(WHITE); }
            drawString(fname, 10, y); y += 16;
        }
    }
    setTextColor(YELLOW); drawString("[PREV/NEXT] [SEL] Load [ESC]", 5, screenHeight - 12);
}

function handleLoadMenu() {
    if (getEscPress()) { appState = "menu"; drawMenu(); return; }
    if (loadedFiles.length === 0) { return; }
    if (getPrevPress()) { loadFileIndex--; if (loadFileIndex < 0) loadFileIndex = loadedFiles.length - 1; drawLoadMenu(); delay(150); }
    if (getNextPress()) { loadFileIndex++; if (loadFileIndex >= loadedFiles.length) loadFileIndex = 0; drawLoadMenu(); delay(150); }
    if (getSelPress()) { delay(200); if (!loadAndDecodeFile(loadedFiles[loadFileIndex])) { drawLoadMenu(); } }
}

// ============================================================================
// HISTORY VIEW
// ============================================================================

function drawHistoryMenu() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("Signal History", 10, 5); setTextSize(1);
    if (history.length === 0) {
        setTextColor(RED); drawString("No signals in history", 10, 35); setTextColor(WHITE);
        drawString("Capture a signal first", 10, 55);
    } else {
        setTextColor(WHITE); drawString("Last " + history.length + " of " + HISTORY_MAX, 10, 30);
        var y = 50;
        var startIdx = Math.max(0, historyIndex - 2);
        var endIdx = Math.min(history.length, startIdx + 5);
        for (var i = startIdx; i < endIdx; i++) {
            var text = historyGetTextItem(i);
            if (i === historyIndex) { drawFillRect(5, y - 2, screenWidth - 10, 14, GRAY); setTextColor(CYAN); }
            else { setTextColor(WHITE); }
            drawString(text, 10, y); y += 16;
        }
    }
    setTextColor(YELLOW); drawString("[PREV/NEXT] [SEL] View [ESC]", 5, screenHeight - 12);
}

function drawHistoryView() {
    if (history.length === 0) { drawHistoryMenu(); return; }
    clearScreen(); setTextSize(2); setTextColor(GREEN); drawString("History Item", 10, 5); setTextSize(1); setTextColor(WHITE);
    var text = historyGetFullItem(historyIndex);
    var lines = text.split("\n");
    var y = 30;
    for (var i = 0; i < lines.length; i++) { drawString(lines[i], 10, y); y += 12; }
    setTextColor(YELLOW); drawString("[PREV/NEXT] Navigate [ESC] Back", 5, screenHeight - 12);
}

function handleHistoryMenu() {
    if (getEscPress()) { appState = "menu"; drawMenu(); return; }
    if (history.length === 0) { return; }
    if (getPrevPress()) { historyIndex--; if (historyIndex < 0) historyIndex = history.length - 1; drawHistoryMenu(); delay(150); }
    if (getNextPress()) { historyIndex++; if (historyIndex >= history.length) historyIndex = 0; drawHistoryMenu(); delay(150); }
    if (getSelPress()) { delay(200); appState = "history_view"; drawHistoryView(); }
}

function handleHistoryView() {
    if (getEscPress()) { appState = "menu"; drawMenu(); return; }
    if (getPrevPress()) { historyIndex--; if (historyIndex < 0) historyIndex = history.length - 1; drawHistoryView(); delay(150); }
    if (getNextPress()) { historyIndex++; if (historyIndex >= history.length) historyIndex = 0; drawHistoryView(); delay(150); }
    if (getSelPress()) { 
        delay(200);
        var item = history[historyIndex];
        lastResult = item.result; lastRawData = item.rawData; frequency = item.frequency;
        presetIndex = item.presetIndex; presetName = item.preset;
        lastCaptureContent = item.content;
        subghz.setFrequency(frequency); resultMenuIndex = 0;
        appState = "result"; drawResult(lastResult);
    }
}

// ============================================================================
// TIMING ANALYZER
// ============================================================================

function drawTimingAnalyzer() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("Timing Analyzer", 10, 5); setTextSize(1); setTextColor(WHITE);
    drawString("Capture a signal to", 10, 30); drawString("analyze timing", 10, 42);
    setTextColor(YELLOW); drawString("[SEL] Capture [ESC] Back", 5, screenHeight - 12);
}

function handleTimingAnalyzer() {
    if (getEscPress()) { appState = "menu"; drawMenu(); return; }
    if (getSelPress()) {
        delay(200); setLongPress(true);
        drawMessage("Capturing...", CYAN);
        var rawContent = readCapture();
        setLongPress(false);
        if (rawContent && rawContent.length > 10) {
            drawMessage("Signal captured!\n(Analysis WIP)", GREEN); delay(1500);
        } else {
            drawMessage("Capture failed", RED); delay(1500);
        }
        drawTimingAnalyzer();
    }
}

// ============================================================================
// SAVE & TRANSMIT
// ============================================================================

function saveSignal() {
    if (!lastResult || !lastRawData) { drawMessage("No signal to save!", RED); delay(1500); return; }
    drawMessage("Saving signal...", YELLOW);
    var r = lastResult; saveCounter++;
    var protoName = r.proto.replace(/[\s\/]/g, "_");
    var filename = "pp_" + protoName + "_" + saveCounter + ".sub";
    var content = savedRawContent();
    var saved = false, savePath = "";
    var paths = ["/" + filename, "/BruceRF/" + filename, "/subghz/" + filename];
    for (var i = 0; i < paths.length; i++) {
        try { storage.write(paths[i], content); saved = true; savePath = paths[i]; break; } catch (e) { }
    }
    if (saved) {
        clearScreen(); setTextSize(2); setTextColor(GREEN); drawString("SAVED!", 10, 5);
        setTextSize(1); setTextColor(WHITE); drawString("File: " + filename, 10, 35);
        setTextColor(YELLOW); drawString("Press any key...", 10, screenHeight - 15); delay(500);
        while (!getSelPress() && !getEscPress() && !getPrevPress() && !getNextPress()) { delay(50); }
    } else { drawMessage("Save FAILED!", RED); delay(2000); }
    drawResult(lastResult);
}

function transmitSignal() {
    if (!lastResult) { drawMessage("No signal to transmit!", RED); delay(1000); return; }
    if (lastResult.receiveOnly) { drawMessage("Receive-only decoder", YELLOW); delay(1000); return; }
    if (lastResult.encrypted) {
        clearScreen(); setTextSize(2); setTextColor(RED); drawString("WARNING!", 10, 5);
        setTextSize(1); setTextColor(WHITE); drawString("ENCRYPTED SIGNAL", 10, 30);
        drawString("May desync your key!", 10, 45);
        setTextColor(GREEN); drawString("[SEL] Continue [ESC] Cancel", 5, screenHeight - 12);
        while (true) { if (getEscPress()) { drawResult(lastResult); return; } if (getSelPress()) { delay(200); break; } delay(50); }
    }
    drawMessage("Transmitting...", YELLOW);
    var freqHz = Math.floor(frequency * 1000000);
    var hexData = toHex(lastResult.dataHi, 8) + toHex(lastResult.dataLo, 8);
    setLongPress(true);
    for (var burst = 0; burst < 3; burst++) {
        if (getEscPress()) break;
        subghz.transmit(hexData, freqHz, 250, 5); delay(150);
    }
    setLongPress(false);
    drawMessage("TX Complete!", GREEN); delay(1500);
    drawResult(lastResult);
}

// ============================================================================
// DRAWING FUNCTIONS
// ============================================================================

function drawMenu() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("ProtoPirate", 10, 5);
    setTextSize(1); setTextColor(WHITE); drawString("Bruce Edition v3.0", 10, 28);
    drawStatusBar();
    var y = 50;
    var first = Math.max(0, menuIndex - 4);
    for (var i = first; i < menuItems.length && i < first + 5; i++) {
        if (i === menuIndex) { drawFillRect(5, y - 2, screenWidth - 10, 16, GRAY); setTextColor(CYAN); }
        else { setTextColor(WHITE); }
        drawString(menuItems[i], 15, y); y += 20;
    }
    setTextColor(YELLOW); drawString("[PREV/NEXT] [SEL] OK", 5, screenHeight - 12);
}

function drawReceive() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("Receiving", 10, 5);
    setTextSize(1); setTextColor(WHITE); drawString("Freq: " + frequency + " MHz", 10, 30);
    setTextColor(YELLOW); drawString("Waiting for signal...", 10, 50);
    setTextColor(WHITE); drawString("Press car key fob button", 10, 70);
    setTextColor(YELLOW); drawString("[ESC] Back", 10, screenHeight - 12);
    drawStatusBar();
}

function drawResult(r) {
    clearScreen(); setTextSize(2); setTextColor(GREEN); drawString("DECODED!", 10, 5);
    setTextSize(1); setTextColor(CYAN); drawString(r.proto + " " + r.bits + "-bit @ " + frequency + "MHz", 10, 28);
    setTextColor(WHITE);
    var y = 42;
    drawString("Key: " + (r.rawHex || (toHex(r.dataHi, 8) + toHex(r.dataLo, 8))), 10, y); y += 12;
    drawString((r.fieldsUnknown ? "Sn:unknown" : "Sn:" + toHex(r.serial, 7)) + " Btn:" + r.btnName, 10, y); y += 12;
    drawString(r.fieldsUnknown ? "Counter:unknown" : "Cnt:0x" + toHex(r.counter, 4), 10, y);
    if (r.crcOk) { setTextColor(GREEN); drawString(r.checkLabel ? "Check:OK" : "CRC:OK", 140, y); }
    else { setTextColor(RED); drawString("CRC:FAIL", 140, y); }
    y = screenHeight - 55;
    var opts = ["Transmit", "Save", "Continue"];
    for (var i = 0; i < opts.length; i++) {
        if (i === resultMenuIndex) { drawFillRect(5, y - 2, screenWidth - 10, 14, GRAY); setTextColor(CYAN); }
        else { setTextColor(WHITE); }
        drawString(opts[i], 15, y); y += 16;
    }
    setTextColor(YELLOW); drawString("[PREV/NEXT] [SEL] OK", 5, screenHeight - 10);
    drawStatusBar();
}

function drawInfo() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("Protocols", 10, 5);
    setTextSize(1); setTextColor(WHITE);
    var y = 28;
    drawString("Implemented: Kia V0 (FM476)", 10, y); y += 13;
    drawString("Chrysler V0 (AM650), RX only", 10, y); y += 13;
    drawString("Other advertised JS decoders", 10, y); y += 13;
    drawString("are not implemented upstream.", 10, y); y += 13;
    drawString("Unknown signals keep RAW data.", 10, y);
    setTextColor(YELLOW); drawString("[ESC] Back", 10, screenHeight - 12);
}

function drawFreqSelect() {
    clearScreen(); setTextSize(2); setTextColor(CYAN); drawString("Frequency", 10, 5);
    setTextSize(1); setTextColor(WHITE); drawString("Select operating frequency:", 10, 30);
    var y = 55;
    var freqLabels = ["315.00 MHz (US)", "433.92 MHz (EU/Asia)", "868.35 MHz (EU)"];
    for (var i = 0; i < freqOptions.length; i++) {
        if (i === freqIndex) { drawFillRect(5, y - 2, screenWidth - 10, 16, GRAY); setTextColor(CYAN); }
        else { setTextColor(WHITE); }
        drawString(freqLabels[i], 15, y); y += 20;
    }
    setTextColor(GREEN); drawString("Current: " + frequency + " MHz", 10, 125);
    setTextColor(YELLOW); drawString("[PREV/NEXT] [SEL] Set [ESC]", 5, screenHeight - 12);
}

// ============================================================================
// STATE HANDLERS - CRITICAL FOR NAVIGATION
// ============================================================================

function handleMenu() {
    if (getPrevPress()) { 
        menuIndex--; 
        if (menuIndex < 0) menuIndex = menuItems.length - 1; 
        drawMenu(); 
        delay(150);  // Debounce
    }
    if (getNextPress()) { 
        menuIndex++; 
        if (menuIndex >= menuItems.length) menuIndex = 0; 
        drawMenu(); 
        delay(150);  // Debounce
    }
    if (getSelPress()) {
        delay(200);  // Debounce
        if (menuIndex === 0) { 
            setLongPress(true); 
            appState = "receive"; 
            drawReceive(); 
        }
        else if (menuIndex === 1) { 
            scanForFiles(); 
            loadFileIndex = 0; 
            appState = "load"; 
            drawLoadMenu(); 
        }
        else if (menuIndex === 2) { 
            historyIndex = 0; 
            appState = "history"; 
            drawHistoryMenu(); 
        }
        else if (menuIndex === 3) { 
            appState = "timing"; 
            drawTimingAnalyzer(); 
        }
        else if (menuIndex === 4) { 
            appState = "freq"; 
            drawFreqSelect(); 
        }
        else if (menuIndex === 5) {
            appState = "preset";
            drawPresetSelect();
        }
        else if (menuIndex === 6) {
            appState = "info"; 
            drawInfo(); 
        }
        else if (menuIndex === 7) {
            appState = "exit"; 
        }
    }
}

function handleFreqSelect() {
    if (getEscPress()) { appState = "menu"; drawMenu(); return; }
    if (getPrevPress()) { 
        freqIndex--; 
        if (freqIndex < 0) freqIndex = freqOptions.length - 1; 
        drawFreqSelect(); 
        delay(150);
    }
    if (getNextPress()) { 
        freqIndex++; 
        if (freqIndex >= freqOptions.length) freqIndex = 0; 
        drawFreqSelect(); 
        delay(150);
    }
    if (getSelPress()) {
        frequency = freqOptions[freqIndex];
        subghz.setFrequency(frequency);
        drawMessage("Frequency: " + frequency + " MHz", GREEN);
        delay(1000);
        appState = "menu";
        drawMenu();
    }
}

function handleReceive() {
    if (getEscPress()) { 
        setLongPress(false); 
        appState = "menu"; 
        drawMenu(); 
        return; 
    }
    var rawContent = readCapture();
    if (getEscPress()) { 
        setLongPress(false); 
        appState = "menu"; 
        drawMenu(); 
        return; 
    }
    if (rawContent && rawContent.length > 10) {
        setLongPress(false);
        var rawStr = extractRawData(rawContent);

        if (rawStr && rawStr.length > 10) {
            var pulses = parseRaw(rawStr);
            if (pulses.length > 20) {
                var result = tryDecode(pulses);
                if (result) {
                    lastResult = result; 
                    lastRawData = rawStr; 
                    resultMenuIndex = 0;
                    historyAdd(result, rawStr);
                    appState = "result";
                    // Clear ALL button presses before state change
                    delay(100);
                    getPrevPress(); getNextPress(); getSelPress(); getEscPress();
                    drawResult(result);
                    setLongPress(true);
                    return;
                } else {
                    lastRawData = rawStr;
                    clearScreen(); setTextSize(1); setTextColor(YELLOW); drawString("Signal captured!", 10, 5);
                    drawString("Unknown protocol", 10, 32);
                    setTextColor(WHITE); drawString("Freq: " + frequency + " MHz", 10, 50);
                    setTextColor(YELLOW); drawString("[SEL] Save Raw [ESC] Menu", 5, screenHeight - 12);
                    while (true) {
                        if (getEscPress()) { 
                            setLongPress(true); 
                            appState = "menu"; 
                            drawMenu(); 
                            return; 
                        }
                        if (getSelPress()) {
                            saveCounter++;
                            var filename = "pp_unknown_" + saveCounter + ".sub";
                            var content = savedRawContent();
                            try { storage.write("/BruceRF/" + filename, content); drawMessage("Saved!", GREEN); delay(1000); } catch(e) { drawMessage("Failed!", RED); delay(1000); }
                            setLongPress(true); 
                            drawReceive(); 
                            return;
                        }
                        delay(50);
                    }
                }
            } else {
                setTextColor(YELLOW); drawFillRect(10, 50, 150, 12, BLACK);
                drawString("Weak signal", 10, 50); delay(1000);
                drawReceive(); return;
            }
        }
    }
}

function handleResult() {
    if (!lastResult) { appState = "menu"; drawMenu(); return; }
    if (getEscPress()) { 
        delay(200); 
        resultMenuIndex = 0; 
        setLongPress(true); 
        appState = "receive"; 
        drawReceive(); 
        return; 
    }
    if (getPrevPress()) { 
        resultMenuIndex--; 
        if (resultMenuIndex < 0) resultMenuIndex = 2; 
        drawResult(lastResult); 
        delay(150);
    }
    if (getNextPress()) { 
        resultMenuIndex++; 
        if (resultMenuIndex > 2) resultMenuIndex = 0; 
        drawResult(lastResult); 
        delay(150);
    }
    if (getSelPress()) {
        delay(200);
        if (resultMenuIndex === 0) { transmitSignal(); }
        else if (resultMenuIndex === 1) { saveSignal(); }
        else { 
            resultMenuIndex = 0; 
            setLongPress(true); 
            appState = "receive"; 
            drawReceive(); 
        }
    }
}

function handleInfo() { 
    if (getEscPress()) { 
        appState = "menu"; 
        drawMenu(); 
    } 
}

// Receive-only adaptation of the Chrysler V0 framing in Sor3nt PR #119,
// commit 4c5e129911607afab93218051f5a4f57a7ac1b06. Credits: ProtoPirate
// contributors / The Pirates' Plunder. No encoder or counter generation.
function decodeChrysler(pulses) {
    var step = 0, preamble = 0, last = 0, bits = [], bytes = [];
    function short(d) { return abs(d - 300) <= 150; }
    function long(d) { return abs(d - 3400) <= 400 || abs(d - 3700) <= 400; }
    for (var i = 0; i < pulses.length; i++) {
        var high = pulses[i] > 0, duration = abs(pulses[i]);
        if (step === 0) {
            if (high && short(duration)) { step = 1; last = duration; preamble = 0; }
        } else if (step === 1) {
            if (high) { last = duration; continue; }
            if (long(duration)) {
                if (short(last)) preamble++;
                else if (preamble > 15) { bits = [1]; step = 2; }
                else preamble = 0;
            } else if (duration > 8000 && preamble > 15) { bits = []; step = 2; }
            else { step = 0; preamble = 0; }
        } else {
            if (high) { last = duration; continue; }
            if (duration > 8000 || last > 750 || !long(duration) || (last < 300 && !short(last))) {
                step = 0; preamble = 0; bits = []; continue;
            }
            bits.push(short(last) ? 0 : 1);
            if (bits.length !== 80) continue;
            bytes = [];
            for (var b = 0; b < 10; b++) {
                var value = 0;
                for (var k = 0; k < 8; k++) value = (value << 1) | bits[b * 8 + k];
                bytes.push(value);
            }
            var xor = bytes[1] ^ bytes[6], button = 1, valid = false;
            if (bytes[0] & 128) {
                valid = bytes[1] === bytes[5] && xor === 0x62;
                button = (bytes[9] ^ bytes[4]) === 0x10 ? 2 : 1;
            } else {
                valid = (bytes[1] ^ 0xC3) === bytes[5] && (xor === 4 || xor === 8);
                button = xor === 8 ? 2 : 1;
            }
            step = 0; preamble = 0; bits = [];
            if (!valid) continue;
            var hex = "";
            for (var j = 0; j < bytes.length; j++) hex += toHex(bytes[j], 2);
            return {proto:"Chrysler V0", bits:80, rawHex:hex, serial:0, button:button,
                btnName:button === 2 ? "Unlock" : "Lock", counter:0, crcOk:true,
                checkLabel:"Structure check", receiveOnly:true, fieldsUnknown:true,
                dataHi:((bytes[0]<<24)|(bytes[1]<<16)|(bytes[2]<<8)|bytes[3])>>>0,
                dataLo:((bytes[4]<<24)|(bytes[5]<<16)|(bytes[6]<<8)|bytes[7])>>>0};
        }
    }
    return null;
}
function drawPresetSelect() {
    clearScreen(); setTextSize(1); setTextColor(CYAN);
    drawString("Receive preset", 10, 15);
    for (var i = 0; i < presetLabels.length; i++) {
        setTextColor(i === presetIndex ? GREEN : WHITE);
        drawString((i === presetIndex ? "> " : "  ") + presetLabels[i], 10, 40 + i * 20);
    }
    setTextColor(YELLOW); drawString("Turn:select Click/Back:apply", 5, screenHeight - 12);
}
function handlePresetSelect() {
    if (getEscPress()) { presetName = presetLabels[presetIndex]; appState = "menu"; drawMenu(); return; }
    if (getPrevPress()) { presetIndex = (presetIndex + 3) % 4; drawPresetSelect(); delay(100); }
    if (getNextPress()) { presetIndex = (presetIndex + 1) % 4; drawPresetSelect(); delay(100); }
    if (getSelPress()) {
        presetName = presetLabels[presetIndex];
        appState = "menu"; drawMenu(); delay(150);
    }
}
function adoptFilePreset(content) {
    var lines = content.split("\n"), found = "";
    for (var i = 0; i < lines.length; i++)
        if (lines[i].indexOf("Preset:") === 0) found = lines[i].substring(7).trim();
    for (var j = 0; j < presetValues.length; j++) {
        if (found === presetValues[j] || found === "FuriHalSubGhzPreset" + presetValues[j]) {
            presetIndex = j; presetName = presetLabels[j]; return true;
        }
    }
    // Unknown/custom modulation must not silently inherit the previous file.
    presetName = "Unknown RX";
    return false;
}

// ============================================================================
// MAIN
// ============================================================================

clearScreen();
setTextSize(2); setTextColor(CYAN);
drawString("ProtoPirate", 30, screenHeight/2 - 15);
setTextSize(1); setTextColor(WHITE);
drawString("Bruce Edition v3.0", 25, screenHeight/2 + 10);
delay(1500);

subghz.setFrequency(frequency);
drawMenu();

while (appState !== "exit") {
    if (appState === "menu") handleMenu();
    else if (appState === "receive") handleReceive();
    else if (appState === "preset") handlePresetSelect();
    else if (appState === "result") handleResult();
    else if (appState === "info") handleInfo();
    else if (appState === "freq") handleFreqSelect();
    else if (appState === "load") handleLoadMenu();
    else if (appState === "history") handleHistoryMenu();
    else if (appState === "history_view") handleHistoryView();
    else if (appState === "timing") handleTimingAnalyzer();
    delay(50);  // Main loop delay - CRITICAL for button polling
}

setLongPress(false);
clearScreen();
setTextColor(WHITE);
drawString("Goodbye!", screenWidth/2 - 25, screenHeight/2);
delay(800);
