// The system map's generator. The map beside this directory (system-map.json) is
// extracted from the code's @system annotations; this file only hands it to the
// drawing the build passes in, so there is nothing here to edit by hand.
export default (kit) => kit.systemMap(new URL("../system-map.json", import.meta.url));
