(function (root) {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  function extractFlightTextFromHtml(html) {
    if (!html || typeof html !== "string") return "";
    const parts = [];
    const marker = "self.__next_f.push(";
    let idx = 0;

    while (idx < html.length) {
      const start = html.indexOf(marker, idx);
      if (start === -1) break;
      const argStart = start + marker.length;
      const endTag = html.indexOf("</script>", argStart);
      if (endTag === -1) break;

      let slice = html.slice(argStart, endTag).trim();
      if (slice.endsWith(";")) slice = slice.slice(0, -1).trim();
      if (slice.endsWith(")")) slice = slice.slice(0, -1).trim();

      try {
        const parsed = JSON.parse(slice);
        if (Array.isArray(parsed) && parsed[0] === 1 && typeof parsed[1] === "string") {
          parts.push(parsed[1]);
        }
      } catch (_) {
        // Ignore non-standard or partial script blocks
      }
      idx = endTag + 9;
    }

    return parts.join("");
  }

  function nextfArrayToFlightText(entries) {
    if (!Array.isArray(entries)) return "";
    const parts = [];
    for (const entry of entries) {
      if (Array.isArray(entry) && entry[0] === 1 && typeof entry[1] === "string") {
        parts.push(entry[1]);
      }
    }
    return parts.join("");
  }

  function parseFlightChunks(rawText) {
    const chunks = Object.create(null);
    if (!rawText || typeof rawText !== "string") return chunks;

    const bytes = encoder.encode(rawText);
    const len = bytes.length;
    let pos = 0;

    const COLON = 0x3a; // :
    const NEWLINE = 0x0a; // \n
    const CR = 0x0d; // \r
    const CHAR_T = 0x54; // T
    const COMMA = 0x2c; // ,

    while (pos < len) {
      while (pos < len && (bytes[pos] === NEWLINE || bytes[pos] === CR)) pos++;
      if (pos >= len) break;

      // Read chunk id up to ':'
      let colonPos = -1;
      for (let i = pos; i < len && i < pos + 32; i++) {
        if (bytes[i] === COLON) {
          colonPos = i;
          break;
        }
        if (bytes[i] === NEWLINE) break;
      }

      if (colonPos === -1) {
        // Skip malformed line
        while (pos < len && bytes[pos] !== NEWLINE) pos++;
        continue;
      }

      const id = decoder.decode(bytes.subarray(pos, colonPos)).trim();
      pos = colonPos + 1;

      if (pos < len && bytes[pos] === CHAR_T) {
        // Text length-prefixed chunk: T<hexLen>,<utf8 bytes>
        let commaPos = -1;
        for (let i = pos + 1; i < len && i < pos + 20; i++) {
          if (bytes[i] === COMMA) {
            commaPos = i;
            break;
          }
          if (bytes[i] === NEWLINE) break;
        }
        if (commaPos !== -1) {
          const hexLen = decoder.decode(bytes.subarray(pos + 1, commaPos));
          const byteLen = parseInt(hexLen, 16);
          if (!Number.isNaN(byteLen) && byteLen >= 0) {
            const textStart = commaPos + 1;
            const textEnd = Math.min(len, textStart + byteLen);
            chunks[id] = decoder.decode(bytes.subarray(textStart, textEnd));
            pos = textEnd;
            continue;
          }
        }
      }

      // Single-line Flight entry
      let lineEnd = pos;
      while (lineEnd < len && bytes[lineEnd] !== NEWLINE) lineEnd++;
      let payloadStr = decoder.decode(bytes.subarray(pos, lineEnd));
      if (payloadStr.endsWith("\r")) payloadStr = payloadStr.slice(0, -1);
      pos = lineEnd + 1;

      if (!id) continue;

      const trimmed = payloadStr.trim();
      if (!trimmed) {
        chunks[id] = "";
        continue;
      }

      const firstChar = trimmed[0];
      if (firstChar === "{" || firstChar === "[" || firstChar === '"' || trimmed === "null" || trimmed === "true" || trimmed === "false" || /^-?\d/.test(trimmed)) {
        try {
          chunks[id] = JSON.parse(trimmed);
          continue;
        } catch (_) {
          // Fall through to raw string
        }
      }
      chunks[id] = payloadStr;
    }

    return chunks;
  }

  function resolveValue(val, chunks, seen = new Set(), depth = 0) {
    if (depth > 28) return val;
    if (val === null || val === undefined) return val;

    if (typeof val === "string") {
      if (val === "$undefined") return undefined;
      if (val === "$NaN") return NaN;
      if (val === "$Infinity") return Infinity;
      if (val === "$-Infinity") return -Infinity;
      if (val.startsWith("$D")) return val.slice(2);

      // Server Action bound reference: $h<hexId>
      const actionMatch = /^\$h([0-9a-f]+)$/i.exec(val);
      if (actionMatch) {
        const refId = actionMatch[1];
        if (seen.has("h:" + refId)) return { __slmAction: true, actionId: null, boundArgs: [] };
        const nextSeen = new Set(seen);
        nextSeen.add("h:" + refId);
        const rawAction = chunks[refId];
        if (rawAction && typeof rawAction === "object" && typeof rawAction.id === "string") {
          let bound = [];
          if (rawAction.bound !== undefined) {
            const resolvedBound = resolveValue(rawAction.bound, chunks, nextSeen, depth + 1);
            if (Array.isArray(resolvedBound)) bound = resolvedBound;
            else if (resolvedBound !== undefined && resolvedBound !== null) bound = [resolvedBound];
          }
          return {
            __slmAction: true,
            actionId: rawAction.id,
            boundArgs: bound
          };
        }
        return val;
      }

      // Standard Flight chunk reference: $@<id> or $<id>
      const refMatch = /^\$@?([0-9a-f]+)$/i.exec(val);
      if (refMatch) {
        const refId = refMatch[1];
        if (Object.prototype.hasOwnProperty.call(chunks, refId) && !seen.has(refId)) {
          const nextSeen = new Set(seen);
          nextSeen.add(refId);
          return resolveValue(chunks[refId], chunks, nextSeen, depth + 1);
        }
      }

      return val;
    }

    if (Array.isArray(val)) {
      return val.map((item) => resolveValue(item, chunks, seen, depth + 1));
    }

    if (typeof val === "object") {
      const out = {};
      for (const key of Object.keys(val)) {
        out[key] = resolveValue(val[key], chunks, seen, depth + 1);
      }
      return out;
    }

    return val;
  }

  function findResolvedNode(chunks, predicate) {
    const visitedObjects = new WeakSet();

    function scan(node, depth = 0) {
      if (!node || typeof node !== "object" || depth > 24) return null;
      if (visitedObjects.has(node)) return null;
      visitedObjects.add(node);

      if (!Array.isArray(node)) {
        try {
          if (predicate(node)) return node;
        } catch (_) {}
      }

      const values = Array.isArray(node) ? node : Object.values(node);
      for (const child of values) {
        if (child && typeof child === "object") {
          const hit = scan(child, depth + 1);
          if (hit) return hit;
        }
      }
      return null;
    }

    // Prioritize likely page chunk IDs first, then scan all chunks
    const keys = Object.keys(chunks);
    const prioritized = ["8", "1", "9", "7", "a", "b", "c"];
    const orderedKeys = [
      ...prioritized.filter((k) => Object.prototype.hasOwnProperty.call(chunks, k)),
      ...keys.filter((k) => !prioritized.includes(k))
    ];

    for (const k of orderedKeys) {
      const val = chunks[k];
      if (!val || typeof val !== "object") continue;
      const resolved = resolveValue(val, chunks);
      const hit = scan(resolved, 0);
      if (hit) return hit;
    }

    return null;
  }

  function toFlightStream(raw, isHtml = false) {
    if (!raw) return "";
    if (Array.isArray(raw)) return nextfArrayToFlightText(raw);
    if (isHtml || (typeof raw === "string" && raw.includes("self.__next_f.push("))) {
      const extracted = extractFlightTextFromHtml(raw);
      if (extracted) return extracted;
    }
    return typeof raw === "string" ? raw : "";
  }

  function extractDashboardData(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) =>
        obj.stats &&
        typeof obj.stats === "object" &&
        obj.salesReport &&
        typeof obj.salesReport === "object" &&
        obj.salesData &&
        typeof obj.salesData === "object"
    );
    if (!props) return null;
    return {
      stats: props.stats || null,
      report: props.report || null,
      salesReport: props.salesReport || null,
      salesData: props.salesData || null,
      today: props.today || null,
      session: props.session || null
    };
  }

  function extractManageData(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) =>
        Array.isArray(obj.initialItems) &&
        typeof obj.totalPages === "number" &&
        ("loadPageAction" in obj || "loadMoreAction" in obj || "merchantId" in obj)
    );
    if (!props) return null;
    return {
      initialItems: props.initialItems || [],
      initialPage: Number(props.initialPage) || 1,
      totalPages: Number(props.totalPages) || 1,
      merchantId: props.merchantId || null,
      loadPageAction: props.loadPageAction && props.loadPageAction.__slmAction ? props.loadPageAction : null,
      loadMoreAction: props.loadMoreAction && props.loadMoreAction.__slmAction ? props.loadMoreAction : null
    };
  }

  function extractAnalyzeData(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) =>
        Array.isArray(obj.initialItems) &&
        typeof obj.totalPages === "number" &&
        ("summery" in obj || "summary" in obj)
    );
    if (!props) return null;
    return {
      initialItems: props.initialItems || [],
      initialPage: Number(props.initialPage) || 1,
      totalPages: Number(props.totalPages) || 1,
      summery: props.summery || props.summary || null,
      loadMoreAction: props.loadMoreAction && props.loadMoreAction.__slmAction ? props.loadMoreAction : null
    };
  }

  function extractActionPageResult(raw) {
    const chunks = parseFlightChunks(toFlightStream(raw, false));
    const hit = findResolvedNode(
      chunks,
      (obj) => Array.isArray(obj.items) && (typeof obj.page === "number" || typeof obj.totalPages === "number")
    );
    if (!hit) return null;
    return {
      items: hit.items || [],
      page: Number(hit.page) || 1,
      pageSize: Number(hit.pageSize) || hit.items.length,
      total: typeof hit.total === "number" ? hit.total : null,
      totalPages: Number(hit.totalPages) || 1
    };
  }

  function extractProductDetail(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) => obj.product && typeof obj.product === "object" && "salesRank" in obj
    );
    if (!props) return null;
    return {
      product: props.product || null,
      salesRank: props.salesRank || null,
      reviewOrderItemId: props.reviewOrderItemId || null
    };
  }

  function extractStorefrontSearch(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) => obj.result && typeof obj.result === "object" && Array.isArray(obj.result.items)
    );
    if (!props) return null;
    return {
      result: props.result,
      brands: props.brands || [],
      q: props.q || "",
      slug: props.slug || "",
      relatedProducts: props.relatedProducts || [],
      loadMoreAction: props.loadMoreAction && props.loadMoreAction.__slmAction ? props.loadMoreAction : null
    };
  }

  function extractCategoryListing(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) => Array.isArray(obj.initialItems) && obj.category && typeof obj.category === "object"
    );
    if (!props) return null;
    return {
      initialItems: props.initialItems || [],
      initialPage: Number(props.initialPage) || 1,
      totalPages: Number(props.totalPages) || 1,
      category: props.category || null,
      relatedProducts: props.relatedProducts || [],
      loadMoreAction: props.loadMoreAction && props.loadMoreAction.__slmAction ? props.loadMoreAction : null
    };
  }

  function buildServerActionFormData(actionDescriptor, page, pageSize) {
    if (!actionDescriptor || !actionDescriptor.actionId) {
      throw new Error("Missing dynamic Next.js Server Action descriptor");
    }
    const boundArgs = Array.isArray(actionDescriptor.boundArgs) ? actionDescriptor.boundArgs : [];
    const fd = new FormData();
    const argRefs = [];

    boundArgs.forEach((arg, index) => {
      const partKey = String(index + 1);
      fd.append(partKey, JSON.stringify(arg));
      argRefs.push("$@" + partKey);
    });

    const formRefIdx = boundArgs.length + 1;
    argRefs.push("$undefined");
    argRefs.push("$K" + formRefIdx);

    fd.append("_" + formRefIdx + "_page", String(page));
    fd.append("_" + formRefIdx + "_pageSize", String(pageSize));
    fd.append("0", JSON.stringify(argRefs));

    return fd;
  }

  function extractLayoutProfileImage(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) =>
        typeof obj.profileImageUrl === "string" &&
        obj.profileImageUrl.length > 0 &&
        ("session" in obj || "user" in obj)
    );
    return props ? props.profileImageUrl : null;
  }

  function extractProfileData(raw, isHtml = false) {
    const chunks = parseFlightChunks(toFlightStream(raw, isHtml));
    const props = findResolvedNode(
      chunks,
      (obj) =>
        obj.user &&
        typeof obj.user === "object" &&
        typeof obj.user.name === "string" &&
        obj.user.merchantProfile &&
        typeof obj.user.merchantProfile === "object"
    );
    const photoFromLayout = extractLayoutProfileImage(raw, isHtml);
    if (!props) {
      return photoFromLayout ? { name: null, profileImageUrl: photoFromLayout } : null;
    }
    return {
      name: String(props.user.name || "").trim() || null,
      email: props.user.email || null,
      profileImageUrl:
        (typeof props.profileImageUrl === "string" && props.profileImageUrl) ||
        photoFromLayout ||
        null,
      tier: props.user.merchantProfile?.tiar ?? null
    };
  }

  root.SLMFlight = {
    extractFlightTextFromHtml,
    nextfArrayToFlightText,
    parseFlightChunks,
    resolveValue,
    findResolvedNode,
    extractDashboardData,
    extractLayoutProfileImage,
    extractProfileData,
    extractManageData,
    extractAnalyzeData,
    extractActionPageResult,
    extractProductDetail,
    extractStorefrontSearch,
    extractCategoryListing,
    buildServerActionFormData
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

