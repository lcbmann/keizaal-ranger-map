class RangerAtlasPreview
{
    static function main():Void
    {
        var app:RangerAtlasMenu = new RangerAtlasMenu(_root);
        app.setState({
            ready: true,
            browserReady: true,
            rangerName: "Lorn Valecroft",
            rank: "Marshal",
            skyrimTime: "Fredas, 17 Last Seed, 4E 202  |  21:42",
            discordOnlineCount: 18,
            inSkyrimCount: 7,
            mapKeyOpensAtlas: true,
            overwatchEnabled: true,
            actionStatus: "Trailmark field actions are ready.",
            honors: ["Long Watch", "Pathfinder", "Winter Patrol", "Corps Cartographer"],
            clipboard: {
                title: "Northern patrol notes",
                body: "Check the road north of Whiterun and report any unusual activity."
            },
            selectedId: "halted-stream",
            player: { x: 4230, y: 3394, heading: 26, stale: false },
            markers: [
                { id: "solitude", title: "Solitude", kind: "settlement", category: "city", source: "official", x: 2480, y: 5034 },
                { id: "dawnstar", title: "Dawnstar", kind: "settlement", category: "city", source: "official", x: 4380, y: 5214 },
                { id: "winterhold", title: "Winterhold", kind: "settlement", category: "city", source: "official", x: 6120, y: 5164 },
                { id: "windhelm", title: "Windhelm", kind: "settlement", category: "city", source: "official", x: 6290, y: 3754 },
                { id: "whiterun", title: "Whiterun", kind: "settlement", category: "city", source: "official", x: 4380, y: 3084 },
                { id: "riften", title: "Riften", kind: "settlement", category: "city", source: "official", x: 6950, y: 1604 },
                { id: "markarth", title: "Markarth", kind: "settlement", category: "city", source: "official", x: 1210, y: 2914 },
                { id: "halted-stream", title: "Halted Stream Headquarters", kind: "trailmark", category: "trailmark", source: "guild", notes: "Current Ranger headquarters. Supplies, reports, and patrol assignments are maintained here.", x: 4210, y: 3404, distanceMeters: 184, headquarters: true, selected: true },
                { id: "morthal-stash", title: "Morthal Stash", kind: "trailmark", category: "trailmark", source: "guild", notes: "A concealed Ranger cache outside Morthal.", x: 3260, y: 3954, distanceMeters: 3820 },
                { id: "nilheim", title: "Nilheim Tower", kind: "trailmark", category: "trailmark", source: "guild", notes: "Look for the marked cache among Nilheim's ruined stones.", x: 5790, y: 2264, distanceMeters: 5100 },
                { id: "refugees-rest", title: "Refugees Rest", kind: "trailmark", category: "trailmark", source: "guild", notes: "The Trailmark is kept near the ruined eastern tower.", x: 6720, y: 3414, distanceMeters: 7400 },
                { id: "giants", title: "Giant activity", kind: "marker", category: "threat", source: "personal", x: 3640, y: 2904 }
            ],
            routes: [
                {
                    id: "western-patrol",
                    title: "Western patrol",
                    color: "#E4B85B",
                    points: [
                        { x: 2480, y: 5034 }, { x: 2720, y: 4504 }, { x: 3260, y: 3954 },
                        { x: 3660, y: 3584 }, { x: 4210, y: 3404 }, { x: 4380, y: 3084 }
                    ]
                },
                {
                    id: "rift-road",
                    title: "Rift road",
                    color: "#8DB48E",
                    points: [
                        { x: 4380, y: 3084 }, { x: 4820, y: 2724 }, { x: 5350, y: 2344 },
                        { x: 5790, y: 2264 }, { x: 6260, y: 1894 }, { x: 6950, y: 1604 }
                    ]
                }
            ],
            rangers: [
                { id: "lorn", title: "Lorn Valecroft", x: 4230, y: 3394, heading: 26, activity: "just now" },
                { id: "stomps", title: "Stomps-In-Water", x: 3960, y: 3214, heading: 112, activity: "1m ago" },
                { id: "marlo", title: "Marlo Craven", x: 4680, y: 3024, heading: 287, activity: "2m ago" }
            ],
            selected: {
                id: "halted-stream",
                title: "Halted Stream Headquarters",
                category: "Trailmark",
                source: "guild",
                notes: "Current Ranger headquarters. Supplies, reports, and patrol assignments are maintained here.",
                x: 4210,
                y: 3404,
                distanceMeters: 13,
                headquarters: true
            },
            nearest: {
                id: "halted-stream",
                title: "Halted Stream Headquarters",
                notes: "Ranger headquarters",
                distanceMeters: 13,
                withinRange: true,
                canCheckIn: true,
                canLeaveDrop: true,
                discordLinked: true,
                visitsEnabled: true,
                visitorLines: [
                    "Lorn Valecroft: left 18m ago",
                    "Stomps-In-Water: arrived 1h ago",
                    "Marlo Craven: left 3h ago"
                ]
            }
        });
    }
}
