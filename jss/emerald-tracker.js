(function (global) {
    "use strict";

    if (global.EmeraldTracker) {
        return;
    }

    var DB_KEY = "emerald_tracker_db_v1";
    var SECTION_ORDER = ["listening", "reading", "writing", "speaking"];

    function nowIso() {
        return new Date().toISOString();
    }

    function parseJson(raw, fallback) {
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    function defaultDb() {
        return {
            version: 1,
            users: {},
            sectionResults: [],
            fullMockResults: [],
            practiceEvents: []
        };
    }

    function readDb() {
        var stored = parseJson(global.localStorage.getItem(DB_KEY), null);
        if (!stored || typeof stored !== "object") {
            return defaultDb();
        }

        return {
            version: 1,
            users: stored.users && typeof stored.users === "object" ? stored.users : {},
            sectionResults: Array.isArray(stored.sectionResults) ? stored.sectionResults : [],
            fullMockResults: Array.isArray(stored.fullMockResults) ? stored.fullMockResults : [],
            practiceEvents: Array.isArray(stored.practiceEvents) ? stored.practiceEvents : []
        };
    }

    function writeDb(db) {
        global.localStorage.setItem(DB_KEY, JSON.stringify(db));
        return db;
    }

    function createId(prefix) {
        return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    }

    function slugify(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "student";
    }

    function roundToHalf(value) {
        var number = Number(value);
        if (!Number.isFinite(number)) {
            return null;
        }
        return Math.round(number * 2) / 2;
    }

    function average(values) {
        var numeric = values.filter(function (value) {
            return Number.isFinite(value);
        });

        if (!numeric.length) {
            return null;
        }

        var total = numeric.reduce(function (sum, value) {
            return sum + value;
        }, 0);

        return total / numeric.length;
    }

    function sortByCreatedAtDesc(items) {
        return items.slice().sort(function (left, right) {
            return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
        });
    }

    function sortByCreatedAtAsc(items) {
        return items.slice().sort(function (left, right) {
            return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
        });
    }

    function toFiniteNumber(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizeBand(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        return roundToHalf(value);
    }

    function sanitizeSection(section) {
        var normalized = String(section || "").trim().toLowerCase();
        return SECTION_ORDER.indexOf(normalized) >= 0 ? normalized : "listening";
    }

    function accuracyPercent(correctAnswers, totalQuestions) {
        if (!Number.isFinite(correctAnswers) || !Number.isFinite(totalQuestions) || totalQuestions <= 0) {
            return null;
        }
        return Math.round((correctAnswers / totalQuestions) * 1000) / 10;
    }

    function getLegacyUser() {
        var currentName = global.localStorage.getItem("userName");
        if (currentName) {
            return { name: currentName };
        }

        var storedUser = parseJson(global.localStorage.getItem("user"), null);
        if (storedUser && typeof storedUser === "object") {
            return storedUser;
        }

        return null;
    }

    function normalizeUser(input) {
        var source = input || getLegacyUser() || {};
        var name = String(source.name || source.userName || source.displayName || "Student").trim() || "Student";
        var email = String(source.email || "").trim();
        var userId = String(source.id || source.userId || source.uid || slugify(email || name)).trim();

        return {
            id: userId,
            name: name,
            email: email,
            createdAt: source.createdAt || nowIso(),
            lastSeenAt: nowIso()
        };
    }

    function convertListeningScoreToBand(score) {
        if (score >= 39) return 9;
        if (score >= 37) return 8.5;
        if (score >= 35) return 8;
        if (score >= 32) return 7.5;
        if (score >= 30) return 7;
        if (score >= 26) return 6.5;
        if (score >= 23) return 6;
        if (score >= 18) return 5.5;
        if (score >= 16) return 5;
        if (score >= 13) return 4.5;
        if (score >= 11) return 4;
        if (score >= 8) return 3.5;
        if (score >= 6) return 3;
        if (score >= 4) return 2.5;
        return 0;
    }

    function convertReadingScoreToBand(score) {
        if (score >= 39) return 9;
        if (score >= 37) return 8.5;
        if (score >= 35) return 8;
        if (score >= 32) return 7.5;
        if (score >= 30) return 7;
        if (score >= 26) return 6.5;
        if (score >= 23) return 6;
        if (score >= 18) return 5.5;
        if (score >= 16) return 5;
        if (score >= 13) return 4.5;
        if (score >= 11) return 4;
        if (score >= 8) return 3.5;
        if (score >= 6) return 3;
        if (score >= 4) return 2.5;
        return 0;
    }

    function inferBand(section, correctAnswers) {
        if (!Number.isFinite(correctAnswers)) {
            return null;
        }

        if (section === "listening") {
            return convertListeningScoreToBand(correctAnswers);
        }

        if (section === "reading") {
            return convertReadingScoreToBand(correctAnswers);
        }

        return null;
    }

    function calculateOverallBand(sections) {
        var values = SECTION_ORDER.map(function (section) {
            return normalizeBand(sections[section]);
        }).filter(function (value) {
            return Number.isFinite(value);
        });

        if (!values.length) {
            return null;
        }

        return roundToHalf(average(values));
    }

    function summarizeSectionResult(result) {
        return {
            id: result.id,
            kind: "section",
            section: result.section,
            title: capitalize(result.section) + " Practice",
            band: result.band,
            correctAnswers: result.correctAnswers,
            totalQuestions: result.totalQuestions,
            accuracy: result.accuracy,
            testId: result.testId || null,
            createdAt: result.createdAt
        };
    }

    function summarizeFullMockResult(result) {
        return {
            id: result.id,
            kind: "fullMock",
            section: "full_mock",
            title: "Full Mock",
            band: result.overallBand,
            overallBand: result.overallBand,
            listeningBand: result.listeningBand,
            readingBand: result.readingBand,
            writingBand: result.writingBand,
            speakingBand: result.speakingBand,
            testId: result.testId || null,
            createdAt: result.createdAt
        };
    }

    function capitalize(value) {
        var text = String(value || "");
        if (!text) {
            return "";
        }
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function differenceLabel(current, previous) {
        if (!Number.isFinite(current) || !Number.isFinite(previous)) {
            return null;
        }

        var diff = roundToHalf(current - previous);
        return {
            value: diff,
            direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
            label: (diff > 0 ? "+" : "") + diff
        };
    }

    function createLocalStorageStore() {
        return {
            kind: "localStorage",

            async upsertUser(user) {
                var db = readDb();
                db.users[user.id] = {
                    ...(db.users[user.id] || {}),
                    ...user,
                    lastSeenAt: nowIso()
                };
                writeDb(db);
                return db.users[user.id];
            },

            async getUser(userId) {
                return readDb().users[userId] || null;
            },

            async getAllUsers() {
                return Object.values(readDb().users);
            },

            async addSectionResult(result) {
                var db = readDb();
                db.sectionResults.push(result);
                writeDb(db);
                return result;
            },

            async getSectionResults(userId) {
                return readDb().sectionResults.filter(function (result) {
                    return result.userId === userId;
                });
            },

            async getAllSectionResults() {
                return readDb().sectionResults.slice();
            },

            async addFullMockResult(result) {
                var db = readDb();
                db.fullMockResults.push(result);
                writeDb(db);
                return result;
            },

            async getFullMockResults(userId) {
                return readDb().fullMockResults.filter(function (result) {
                    return result.userId === userId;
                });
            },

            async getAllFullMockResults() {
                return readDb().fullMockResults.slice();
            },

            async addPracticeEvent(event) {
                var db = readDb();
                db.practiceEvents.push(event);
                writeDb(db);
                return event;
            },

            async getPracticeEvents(userId) {
                return readDb().practiceEvents.filter(function (event) {
                    return event.userId === userId;
                });
            }
        };
    }

    var activeStore = createLocalStorageStore();

    function validateStore(store) {
        var requiredMethods = [
            "upsertUser",
            "getUser",
            "getAllUsers",
            "addSectionResult",
            "getSectionResults",
            "getAllSectionResults",
            "addFullMockResult",
            "getFullMockResults",
            "getAllFullMockResults",
            "addPracticeEvent",
            "getPracticeEvents"
        ];

        requiredMethods.forEach(function (methodName) {
            if (!store || typeof store[methodName] !== "function") {
                throw new Error("EmeraldTracker store is missing method: " + methodName);
            }
        });
    }

    async function setStore(nextStore) {
        validateStore(nextStore);
        activeStore = nextStore;
        return activeStore.kind || "custom";
    }

    function getCurrentUser() {
        return normalizeUser();
    }

    async function ensureUser(userInput) {
        var user = normalizeUser(userInput);
        await activeStore.upsertUser(user);
        return user;
    }

    async function recordPracticeEvent(input) {
        var user = await ensureUser(input && input.user ? input.user : null);
        var event = {
            id: createId("event"),
            userId: user.id,
            userName: user.name,
            eventType: String((input && input.eventType) || "practice_event"),
            section: input && input.section ? sanitizeSection(input.section) : null,
            testId: input && input.testId ? String(input.testId) : null,
            score: input && Number.isFinite(Number(input.score)) ? Number(input.score) : null,
            band: input ? normalizeBand(input.band) : null,
            createdAt: (input && input.createdAt) || nowIso(),
            meta: (input && input.meta) || {}
        };

        await activeStore.addPracticeEvent(event);
        return event;
    }

    async function recordSectionResult(input) {
        var user = await ensureUser(input && input.user ? input.user : null);
        var section = sanitizeSection(input && input.section);
        var correctAnswers = toFiniteNumber(
            input && (input.correctAnswers ?? input.correct ?? input.score),
            null
        );
        var totalQuestions = toFiniteNumber(
            input && (input.totalQuestions ?? input.total),
            40
        );
        var band = normalizeBand(input && input.band);

        if (!Number.isFinite(band)) {
            band = inferBand(section, correctAnswers);
        }

        var result = {
            id: createId("section"),
            userId: user.id,
            userName: user.name,
            section: section,
            testId: input && input.testId ? String(input.testId) : null,
            correctAnswers: correctAnswers,
            totalQuestions: totalQuestions,
            accuracy: accuracyPercent(correctAnswers, totalQuestions),
            band: band,
            answers: input && input.answers ? input.answers : null,
            createdAt: (input && input.createdAt) || nowIso(),
            mode: (input && input.mode) || "practice",
            meta: (input && input.meta) || {}
        };

        await activeStore.addSectionResult(result);
        await activeStore.addPracticeEvent({
            id: createId("event"),
            userId: user.id,
            userName: user.name,
            eventType: "section_completed",
            section: section,
            testId: result.testId,
            score: correctAnswers,
            band: band,
            createdAt: result.createdAt,
            meta: {
                resultId: result.id
            }
        });

        return result;
    }

    async function recordFullMockResult(input) {
        var user = await ensureUser(input && input.user ? input.user : null);
        var listeningBand = normalizeBand(input && input.listeningBand);
        var readingBand = normalizeBand(input && input.readingBand);
        var writingBand = normalizeBand(input && input.writingBand);
        var speakingBand = normalizeBand(input && input.speakingBand);
        var overallBand = normalizeBand(input && input.overallBand);

        if (!Number.isFinite(overallBand)) {
            overallBand = calculateOverallBand({
                listening: listeningBand,
                reading: readingBand,
                writing: writingBand,
                speaking: speakingBand
            });
        }

        var result = {
            id: createId("fullmock"),
            userId: user.id,
            userName: user.name,
            testId: input && input.testId ? String(input.testId) : null,
            listeningBand: listeningBand,
            readingBand: readingBand,
            writingBand: writingBand,
            speakingBand: speakingBand,
            overallBand: overallBand,
            rawScores: input && input.rawScores ? input.rawScores : null,
            answers: input && input.answers ? input.answers : null,
            createdAt: (input && input.createdAt) || nowIso(),
            mode: "full_mock",
            meta: (input && input.meta) || {}
        };

        await activeStore.addFullMockResult(result);
        await activeStore.addPracticeEvent({
            id: createId("event"),
            userId: user.id,
            userName: user.name,
            eventType: "full_mock_completed",
            section: null,
            testId: result.testId,
            score: null,
            band: overallBand,
            createdAt: result.createdAt,
            meta: {
                resultId: result.id
            }
        });

        return result;
    }

    async function getRecentResults(userId, limit) {
        var effectiveUserId = userId || getCurrentUser().id;
        var maxItems = Number.isFinite(Number(limit)) ? Number(limit) : 5;
        var sectionResults = await activeStore.getSectionResults(effectiveUserId);
        var fullMockResults = await activeStore.getFullMockResults(effectiveUserId);

        return sortByCreatedAtDesc(
            sectionResults.map(summarizeSectionResult).concat(fullMockResults.map(summarizeFullMockResult))
        ).slice(0, maxItems);
    }

    async function getSectionStats(userId) {
        var effectiveUserId = userId || getCurrentUser().id;
        var results = await activeStore.getSectionResults(effectiveUserId);
        var groups = {};

        SECTION_ORDER.forEach(function (section) {
            groups[section] = [];
        });

        results.forEach(function (result) {
            groups[result.section] = groups[result.section] || [];
            groups[result.section].push(result);
        });

        return SECTION_ORDER.map(function (section) {
            var sectionResults = sortByCreatedAtDesc(groups[section] || []);
            var bands = sectionResults.map(function (result) {
                return normalizeBand(result.band);
            }).filter(function (band) {
                return Number.isFinite(band);
            });
            var accuracies = sectionResults.map(function (result) {
                return result.accuracy;
            }).filter(function (accuracy) {
                return Number.isFinite(accuracy);
            });

            return {
                section: section,
                attempts: sectionResults.length,
                averageBand: bands.length ? roundToHalf(average(bands)) : null,
                latestBand: bands.length ? bands[0] : null,
                bestBand: bands.length ? Math.max.apply(null, bands) : null,
                averageAccuracy: accuracies.length ? Math.round(average(accuracies) * 10) / 10 : null,
                lastAttemptAt: sectionResults[0] ? sectionResults[0].createdAt : null
            };
        });
    }

    async function getWeakestStrongestSection(userId) {
        var stats = await getSectionStats(userId);
        var attempted = stats.filter(function (item) {
            return Number.isFinite(item.averageBand);
        });

        if (!attempted.length) {
            return {
                weakest: null,
                strongest: null
            };
        }

        var weakest = attempted.slice().sort(function (left, right) {
            return left.averageBand - right.averageBand;
        })[0];

        var strongest = attempted.slice().sort(function (left, right) {
            return right.averageBand - left.averageBand;
        })[0];

        return {
            weakest: weakest,
            strongest: strongest
        };
    }

    async function getProgressSeries(userId) {
        var effectiveUserId = userId || getCurrentUser().id;
        var fullMockResults = sortByCreatedAtAsc(await activeStore.getFullMockResults(effectiveUserId));

        if (fullMockResults.length) {
            return fullMockResults.map(function (result) {
                return {
                    date: result.createdAt,
                    label: new Date(result.createdAt).toLocaleDateString(),
                    kind: "fullMock",
                    band: result.overallBand
                };
            });
        }

        var sectionResults = sortByCreatedAtAsc(await activeStore.getSectionResults(effectiveUserId));
        return sectionResults.map(function (result) {
            return {
                date: result.createdAt,
                label: new Date(result.createdAt).toLocaleDateString(),
                kind: result.section,
                band: result.band
            };
        });
    }

    async function getLeaderboard(limit) {
        var users = await activeStore.getAllUsers();
        var allFullMocks = await activeStore.getAllFullMockResults();
        var allSectionResults = await activeStore.getAllSectionResults();
        var maxItems = Number.isFinite(Number(limit)) ? Number(limit) : 10;

        var userMap = {};
        users.forEach(function (user) {
            userMap[user.id] = user;
        });

        var groupedFullMocks = {};
        allFullMocks.forEach(function (result) {
            groupedFullMocks[result.userId] = groupedFullMocks[result.userId] || [];
            groupedFullMocks[result.userId].push(result);
        });

        var groupedSections = {};
        allSectionResults.forEach(function (result) {
            groupedSections[result.userId] = groupedSections[result.userId] || [];
            groupedSections[result.userId].push(result);
        });

        var ranked = Object.keys(userMap).map(function (userId) {
            var fullMockBands = (groupedFullMocks[userId] || []).map(function (item) {
                return normalizeBand(item.overallBand);
            }).filter(function (band) {
                return Number.isFinite(band);
            });

            var sectionBands = (groupedSections[userId] || []).map(function (item) {
                return normalizeBand(item.band);
            }).filter(function (band) {
                return Number.isFinite(band);
            });

            var bandSource = fullMockBands.length ? fullMockBands : sectionBands;
            var averageBand = bandSource.length ? roundToHalf(average(bandSource)) : null;

            return {
                userId: userId,
                userName: userMap[userId].name || "Student",
                averageBand: averageBand,
                attempts: fullMockBands.length,
                sectionAttempts: sectionBands.length,
                bestBand: bandSource.length ? Math.max.apply(null, bandSource) : null
            };
        }).filter(function (item) {
            return Number.isFinite(item.averageBand);
        }).sort(function (left, right) {
            if (right.averageBand !== left.averageBand) {
                return right.averageBand - left.averageBand;
            }
            return right.bestBand - left.bestBand;
        }).map(function (item, index) {
            return {
                rank: index + 1,
                ...item
            };
        });

        return ranked.slice(0, maxItems);
    }

    async function getUserDashboardStats(userId) {
        var effectiveUserId = userId || getCurrentUser().id;
        var fullMocks = sortByCreatedAtDesc(await activeStore.getFullMockResults(effectiveUserId));
        var recentResults = await getRecentResults(effectiveUserId, 5);
        var sectionStats = await getSectionStats(effectiveUserId);
        var insights = await getWeakestStrongestSection(effectiveUserId);
        var progressSeries = await getProgressSeries(effectiveUserId);

        var latestFullMock = fullMocks[0] || null;
        var previousFullMock = fullMocks[1] || null;
        var sectionBands = sectionStats.map(function (item) {
            return item.averageBand;
        }).filter(function (value) {
            return Number.isFinite(value);
        });

        return {
            userId: effectiveUserId,
            currentOverallBand: latestFullMock ? latestFullMock.overallBand : (sectionBands.length ? roundToHalf(average(sectionBands)) : null),
            latestFullMock: latestFullMock,
            previousFullMock: previousFullMock,
            fullMockChange: latestFullMock && previousFullMock
                ? differenceLabel(latestFullMock.overallBand, previousFullMock.overallBand)
                : null,
            recentResults: recentResults,
            sectionStats: sectionStats,
            weakestSection: insights.weakest,
            strongestSection: insights.strongest,
            progressSeries: progressSeries
        };
    }

    async function getAttemptById(attemptId, userId) {
        var id = String(attemptId || "").trim();
        if (!id) return null;
        var effectiveUserId = userId || getCurrentUser().id;
        var sections = await activeStore.getSectionResults(effectiveUserId);
        var sectionMatch = sections.find(function (result) {
            return result.id === id;
        });
        if (sectionMatch) {
            return {
                kind: "section",
                ...sectionMatch
            };
        }

        var mocks = await activeStore.getFullMockResults(effectiveUserId);
        var mockMatch = mocks.find(function (result) {
            return result.id === id;
        });
        return mockMatch ? { kind: "fullMock", ...mockMatch } : null;
    }

    async function getPlatformInsights() {
        var users = await activeStore.getAllUsers();
        var allSections = await activeStore.getAllSectionResults();
        var allMocks = await activeStore.getAllFullMockResults();
        var latestByUser = {};
        allSections.forEach(function (result) {
            var current = latestByUser[result.userId];
            if (!current || new Date(result.createdAt).getTime() > new Date(current.createdAt).getTime()) {
                latestByUser[result.userId] = result;
            }
        });
        var latestBands = Object.values(latestByUser).map(function (item) {
            return normalizeBand(item.band);
        }).filter(function (value) {
            return Number.isFinite(value);
        });
        return {
            totalUsers: users.length,
            totalSectionAttempts: allSections.length,
            totalFullMocks: allMocks.length,
            averageLatestSectionBand: latestBands.length ? roundToHalf(average(latestBands)) : null
        };
    }

    function exportResultsCsv() {
        var db = readDb();
        var rows = [["type", "id", "userId", "userName", "section", "band", "score", "total", "createdAt"]];
        db.sectionResults.forEach(function (result) {
            rows.push([
                "section",
                result.id,
                result.userId,
                result.userName,
                result.section,
                result.band,
                result.correctAnswers,
                result.totalQuestions,
                result.createdAt
            ]);
        });
        db.fullMockResults.forEach(function (result) {
            rows.push([
                "full_mock",
                result.id,
                result.userId,
                result.userName,
                "full_mock",
                result.overallBand,
                "",
                "",
                result.createdAt
            ]);
        });
        return rows.map(function (row) {
            return row.map(function (cell) {
                var value = cell === null || cell === undefined ? "" : String(cell);
                return '"' + value.replace(/"/g, '""') + '"';
            }).join(",");
        }).join("\n");
    }

    function exportLocalDatabase() {
        return readDb();
    }

    function importLocalDatabase(payload) {
        if (!payload || typeof payload !== "object") {
            throw new Error("EmeraldTracker import payload must be an object.");
        }

        var nextDb = defaultDb();
        nextDb.users = payload.users && typeof payload.users === "object" ? payload.users : {};
        nextDb.sectionResults = Array.isArray(payload.sectionResults) ? payload.sectionResults : [];
        nextDb.fullMockResults = Array.isArray(payload.fullMockResults) ? payload.fullMockResults : [];
        nextDb.practiceEvents = Array.isArray(payload.practiceEvents) ? payload.practiceEvents : [];

        writeDb(nextDb);
        return nextDb;
    }

    global.EmeraldTracker = {
        version: "1.0.0",
        storeKind: function () {
            return activeStore.kind || "custom";
        },
        COLLECTIONS: {
            USERS: "users",
            SECTION_RESULTS: "sectionResults",
            FULL_MOCK_RESULTS: "fullMockResults",
            PRACTICE_EVENTS: "practiceEvents"
        },
        getCurrentUser: getCurrentUser,
        ensureUser: ensureUser,
        setStore: setStore,
        recordPracticeEvent: recordPracticeEvent,
        recordSectionResult: recordSectionResult,
        recordFullMockResult: recordFullMockResult,
        getRecentResults: getRecentResults,
        getSectionStats: getSectionStats,
        getWeakestStrongestSection: getWeakestStrongestSection,
        getProgressSeries: getProgressSeries,
        getLeaderboard: getLeaderboard,
        getUserDashboardStats: getUserDashboardStats,
        getAttemptById: getAttemptById,
        getAllUsers: function () {
            return activeStore.getAllUsers();
        },
        getAllSectionResults: function () {
            return activeStore.getAllSectionResults();
        },
        getAllFullMockResults: function () {
            return activeStore.getAllFullMockResults();
        },
        getPlatformInsights: getPlatformInsights,
        calculateOverallBand: calculateOverallBand,
        convertListeningScoreToBand: convertListeningScoreToBand,
        convertReadingScoreToBand: convertReadingScoreToBand,
        createUserId: slugify,
        exportLocalDatabase: exportLocalDatabase,
        importLocalDatabase: importLocalDatabase,
        exportResultsCsv: exportResultsCsv
    };
})(window);
