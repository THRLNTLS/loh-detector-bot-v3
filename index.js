/**
 * Детектор лоха v3.0.0
 * Telegram бот для выбора "лоха дня" в групповых чатах
 * Author: THRLNTLS
 */

// Импорты
const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('@octokit/rest');
const http = require('http');
require('dotenv').config();

// Загрузка переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// Настройки бота
const BOT_VERSION = '3.0.0';
const PORT = process.env.PORT || 3000;
const AUTOSAVE_INTERVAL = parseInt(process.env.AUTOSAVE_INTERVAL) || 15;
const DICE_DELAY = parseInt(process.env.DICE_DELAY) || 2000;
const SPAM_THRESHOLD = parseInt(process.env.SPAM_THRESHOLD) || 3;

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Инициализация GitHub API (если указан токен)
const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : null;

// Структура данных бота
const botData = {
    chats: {},     // Данные о чатах
    users: {},     // Статистика пользователей
    clicks: {},    // Счетчики кликов для антиспама
    immunity: {},  // Система иммунитета
    stats: {       // Глобальная статистика бота
        totalUsers: 0,
        totalMessages: 0,
        totalDiceRolls: 0,
        botStartTime: new Date().toISOString(),
        lastSaveTime: null,
        saveErrors: 0
    }
};

// Состояния для рассылки
const broadcastStates = new Map();

// ===== ТЕКСТЫ СООБЩЕНИЙ И ШАБЛОНЫ =====

// Варианты анимированных эмодзи с их API значениями
const ANIMATED_EMOJIS = [
    { emoji: '🎲', type: 'dice', description: 'кубик' },
    { emoji: '🎯', type: 'dart', description: 'дротик' },
    { emoji: '🏀', type: 'basketball', description: 'баскетбольный мяч' },
    { emoji: '⚽', type: 'football', description: 'футбольный мяч' },
    { emoji: '🎰', type: 'slot', description: 'слот-машину' },
    { emoji: '🎳', type: 'bowling', description: 'боулинг' }
];

// Тематические объявления по типу анимации
const THEMATIC_ANNOUNCEMENTS = {
    'dice': [
        username => `🎲 Кубик судьбы выбрал лоха дня: ${username}!`,
        username => `🎲 Рандом решил твою судьбу, ${username}!`
    ],
    'dart': [
        username => `🎯 Дротик судьбы попал прямо в ${username}!`,
        username => `🎯 Точно в цель! ${username} - сегодняшний лох!`
    ],
    'basketball': [
        username => `🏀 Мяч закинут, ${username} - сегодня ты MVP среди лохов!`,
        username => `🏀 Трехочковый бросок! ${username} забирает титул лоха дня!`
    ],
    'football': [
        username => `⚽ ГОООЛ! ${username} пропускает и становится лохом дня!`,
        username => `⚽ Красная карточка выписана на имя ${username} - лох дня!`
    ],
    'slot': [
        username => `🎰 Джекпот сорван! ${username} выигрывает титул лоха дня!`,
        username => `🎰 Три семерки! ${username} - счастливый лох сегодняшнего дня!`
    ],
    'bowling': [
        username => `🎳 Страйк! Все кегли сбиты, и ${username} становится лохом дня!`,
        username => `🎳 Боулинг определил! ${username} - самый меткий лох сегодня!`
    ]
};

// Сообщения для среды (жаба дня)
const WEDNESDAY_FROG_ANNOUNCEMENTS = [
    username => `🐸 Внимание! Обнаружена среда! ${username} официально объявляется жабой дня! It's Wednesday my dudes!`,
    username => `🐸 О, а чоита тут у нас? Среда? Нарекаю ${username} главной жабою! Аминь`,
    username => `🐸 WEDNESDAY ALERT! 🐸 ${username} Скажи "Ква".`,
    username => `🐸 Сериал про среду все смотрели? Едва ли, но не суть. Это не отменяет того факта, что сегодня С Р Е Д А! А поэтому ${username} назначается главной жабою ыыыааа похлопаем хором.`,
    username => `🐸 AAAAAAAAAAA! IT'S WEDNESDAY MY DUDES! 🐸 ${username} сегодня назначается официальной жабой дня!`
];

// Стандартные объявления лоха дня
const LOSER_ANNOUNCEMENTS = [
    username => `🎯 По результатам тщательного анализа...\n\n🏆 Сегодняшний лох дня: ${username} 🎉`,
    username => `🔍 ВНИМАНИЕ! Сканирование завершено!\n\n👑 Королевским указом назначаю ${username} лохом дня!`,
    username => `🎭 Барабанная дробь...\n\n🎪 И сегодняшним победителем в номинации "Лох дня" становится ${username}!`,
    username => `🧠 Мои нейросети проанализировали всех участников...\n\n🤡 ${username} - поздравляю! Ты сегодня главный лох!`
];

// Философские размышления
const PHILOSOPHICAL_ANNOUNCEMENTS = [
    username => `🧘‍♂️ Дзен-буддисты говорят, что каждый из нас - лох в своей вселенной.\n\nНо сегодня ${username} - лох во всех параллельных вселенных одновременно.`,
    username => `🔮 Что есть лох? Лох - это состояние души, а не человек...\n\nНо сегодня ${username} воплощает в себе эту концепцию в чистом виде!`,
    username => `🌌 В бесконечности вселенной, среди миллиардов галактик, в спирали нашего Млечного пути...\n\nНет никого большего лоха, чем ${username} сегодня.`
];

// Ответы на повторные клики
const REPEAT_CLICK_RESPONSES = [
    username => `Ало, приём! Сегодняшний лох уже в студии, это ${username} 🎯`,
    username => `А ничего, что лоха уже выбрали? Это ${username}, если что 🤦‍♂️`,
    username => `Может хватит кнопку лапать? ${username} уже получил свою корону лоха 👑`,
    username => `Хватит спамить, сегодня ${username} заслуженно носит титул!`,
    username => `Не дави на кнопку так часто, она не виновата что ${username} сегодня лох дня!`
];

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

// Форматирование даты и времени
function getCurrentDate() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function isWednesday() {
    return new Date().getDay() === 3;
}

// Получение случайного элемента из массива
function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

// Получение случайной анимации
function getRandomAnimatedEmoji() {
    return getRandomElement(ANIMATED_EMOJIS);
}

// Форматирование имени пользователя
function formatUsername(user) {
    if (!user) return 'Неизвестный пользователь';
    return user.username 
        ? `@${user.username}` 
        : `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`;
}

// Логирование действий
function logAction(action, details = '') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${action}${details ? ': ' + details : ''}`);
}

// Определение уровня прав пользователя
async function getUserPermissionLevel(chatId, userId) {
    if (userId.toString() === ADMIN_ID) return 'GLOBAL_ADMIN';
    if (chatId < 0) { // Групповой чат
        try {
            const chatMember = await bot.getChatMember(chatId, userId);
            if (['creator', 'administrator'].includes(chatMember.status)) {
                return 'CHAT_ADMIN';
            }
        } catch (error) {
            logAction('PERMISSION_CHECK_ERROR', `Chat: ${chatId}, User: ${userId}, Error: ${error.message}`);
        }
    }
    return 'USER';
}

// Функции для работы с GitHub
async function saveToGitHub(filename, data) {
    if (!octokit) return false;

    try {
        // Получаем текущий файл и его SHA (если существует)
        let sha;
        try {
            const { data: fileData } = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: `data/${filename}`
            });
            sha = fileData.sha;
        } catch (error) {
            // Файл не существует, это нормально
        }

        // Создаем или обновляем файл
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: `data/${filename}`,
            message: `Update ${filename} - ${new Date().toISOString()}`,
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha: sha
        });

        logAction('GITHUB_SAVE', `Успешно сохранено в ${filename}`);
        return true;
    } catch (error) {
        logAction('GITHUB_SAVE_ERROR', `${filename}: ${error.message}`);
        return false;
    }
}

async function loadFromGitHub(filename) {
    if (!octokit) return null;

    try {
        const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: `data/${filename}`
        });

        const content = Buffer.from(data.content, 'base64').toString();
        return JSON.parse(content);
    } catch (error) {
        logAction('GITHUB_LOAD_ERROR', `${filename}: ${error.message}`);
        return null;
    }
}

// Автосохранение данных
async function autoSave() {
    logAction('AUTOSAVE', 'Начало автосохранения');

    try {
        // Сохраняем в GitHub
        if (octokit) {
            await saveToGitHub('bot_data.json', botData);
        }

        botData.stats.lastSaveTime = new Date().toISOString();
        logAction('AUTOSAVE', 'Автосохранение завершено успешно');
    } catch (error) {
        botData.stats.saveErrors++;
        logAction('AUTOSAVE_ERROR', error.message);
    }
}

// Получение текста кнопки в зависимости от дня недели
function getButtonText() {
    return isWednesday()
        ? "🐸 Ho is da dude today?"
        : "🎲 Задетектить сегодняшнего лоха";
}

// Создание клавиатуры
function createDetectionKeyboard() {
    return {
        keyboard: [[getButtonText()]],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// ===== ОСНОВНОЙ ФУНКЦИОНАЛ ДЕТЕКЦИИ =====

// Получение случайного объявления
function getRandomAnnouncement(username, animationType) {
    // Если среда, используем сообщения для жабы
    if (isWednesday()) {
        return getRandomElement(WEDNESDAY_FROG_ANNOUNCEMENTS)(username);
    }

    // Если указан тип анимации, используем тематические сообщения
    if (animationType && THEMATIC_ANNOUNCEMENTS[animationType]) {
        return getRandomElement(THEMATIC_ANNOUNCEMENTS[animationType])(username);
    }

    // Иначе используем стандартные или философские сообщения
    return getRandomElement([...LOSER_ANNOUNCEMENTS, ...PHILOSOPHICAL_ANNOUNCEMENTS])(username);
}

// Отслеживание кликов для антиспама
function trackUserClick(chatId, userId) {
    const key = `${chatId}_${userId}`;
    if (!botData.clicks[key]) {
        botData.clicks[key] = { count: 0, date: getCurrentDate() };
    }

    // Сбрасываем счетчик если дата изменилась
    if (botData.clicks[key].date !== getCurrentDate()) {
        botData.clicks[key] = { count: 0, date: getCurrentDate() };
    }

    botData.clicks[key].count++;
    return botData.clicks[key].count;
}

// Получение текущего лоха дня
function getCurrentLoser(chatId) {
    const chat = botData.chats[chatId];
    if (!chat) return null;

    // Проверяем, выбран ли лох на сегодня
    if (chat.loserDate === getCurrentDate() && chat.currentLoser) {
        return chat.currentLoser;
    }
    return null;
}

// Установка лоха дня
function setLoserOfTheDay(chatId, userId, username) {
    // Создаем запись чата если её нет
    if (!botData.chats[chatId]) {
        botData.chats[chatId] = {
            addedDate: new Date().toISOString(),
            currentLoser: null,
            loserDate: null
        };
    }

    // Обновляем данные о лохе
    botData.chats[chatId].currentLoser = { userId, username };
    botData.chats[chatId].loserDate = getCurrentDate();

    // Обновляем статистику пользователя
    if (!botData.users[userId]) {
        botData.users[userId] = {
            username,
            totalChecks: 0,
            loserCount: 0,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };
        botData.stats.totalUsers++;
    }

    botData.users[userId].loserCount++;
    botData.users[userId].lastSeen = new Date().toISOString();
    botData.users[userId].username = username; // Обновляем имя пользователя
}

// Основная функция детекции лоха
async function detectLoser(chatId, fromUserId) {
    const entityType = isWednesday() ? 'жабу' : 'лоха';
    logAction('DETECT_START', `Определение ${entityType} в чате ${chatId} от пользователя ${fromUserId}`);

    // Проверяем, выбран ли уже лох на сегодня
    const currentLoser = getCurrentLoser(chatId);

    if (currentLoser) {
        // Отслеживаем клики для антиспама
        const clickCount = trackUserClick(chatId, fromUserId);

        // Если превышен лимит кликов, делаем кликающего новым лохом
        if (clickCount >= SPAM_THRESHOLD) {
            const spammerUser = botData.users[fromUserId];
            const spammerUsername = spammerUser ? spammerUser.username : 'Спамер';

            setLoserOfTheDay(chatId, fromUserId, spammerUsername);

            return bot.sendMessage(chatId,
                `🤦‍♂️ Поздравляю! Теперь ${entityType} дня - это ты, ${spammerUsername}!\n\n` +
                `${currentLoser.username} освобожден от оков благодаря твоему спаму.`
            );
        }

        // Отправляем случайный ответ на повторное нажатие
        const response = getRandomElement(REPEAT_CLICK_RESPONSES)(currentLoser.username);
        return bot.sendMessage(chatId, response);
    }

    try {
        // Получаем информацию о чате
        const chat = await bot.getChat(chatId);
        
        // Получаем список администраторов
        const admins = await bot.getChatAdministrators(chatId);
        if (!admins || admins.length < 2) {
            return bot.sendMessage(chatId, 
                'В чате слишком мало участников для определения лоха дня! ' +
                'Нужно минимум 2 администратора (не считая ботов).'
            );
        }

        // Фильтруем участников с иммунитетом
        const eligibleAdmins = admins.filter(admin => 
            !admin.user.is_bot && 
            !hasImmunity(chatId, admin.user.id)
        );

        if (eligibleAdmins.length === 0) {
            return bot.sendMessage(chatId,
                `В этом чате все участники имеют иммунитет от выбора ${entityType} дня! ` +
                'Дождитесь окончания срока действия иммунитета.'
            );
        }

        // Выбираем случайного участника
        const selectedAdmin = getRandomElement(eligibleAdmins);
        const loserUsername = formatUsername(selectedAdmin.user);

        // Отправляем предварительное сообщение
        await bot.sendMessage(chatId, `🔍 Внимание! Вычисляю сегодняшнего ${entityType}...`);

        // Выбираем и отправляем случайную анимацию
        const randomAnimation = getRandomAnimatedEmoji();
        await bot.sendDice(chatId, { emoji: randomAnimation.emoji });
        botData.stats.totalDiceRolls++;

        // Ждем завершения анимации
        await new Promise(resolve => setTimeout(resolve, DICE_DELAY));

        // Устанавливаем лоха дня
        setLoserOfTheDay(chatId, selectedAdmin.user.id, loserUsername);

        // Получаем и отправляем объявление
        const announcement = getRandomAnnouncement(loserUsername, randomAnimation.type);
        await bot.sendMessage(chatId, announcement);

        logAction('DETECT_SUCCESS', `${loserUsername} объявлен ${entityType}м дня`);

    } catch (error) {
        logAction('DETECT_ERROR', error.message);
        await bot.sendMessage(chatId, 'Произошла ошибка при определении лоха дня. Попробуйте позже.');
    }
}

// ===== ОБРАБОТЧИКИ КОМАНД =====

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        if (msg.chat.type === 'private') {
            await bot.sendMessage(chatId,
                '👋 Привет! Я бот для определения лоха дня.\n\n' +
                '❗️ Я работаю только в групповых чатах.\n' +
                '➡️ Добавь меня в группу и дай права администратора!'
            );
            return;
        }

        // Добавляем чат в базу если его нет
        if (!botData.chats[chatId]) {
            botData.chats[chatId] = {
                title: msg.chat.title,
                type: msg.chat.type,
                addedDate: new Date().toISOString(),
                currentLoser: null,
                loserDate: null
            };
        }

        // Отправляем приветствие и клавиатуру
        await bot.sendMessage(chatId,
            '🎲 Бот успешно активирован!\n\n' +
            '📝 Используйте кнопку ниже или команду /loser для определения лоха дня.',
            { reply_markup: createDetectionKeyboard() }
        );

    } catch (error) {
        logAction('START_ERROR', error.message);
        await bot.sendMessage(chatId, 'Произошла ошибка при запуске бота. Проверьте мои права администратора.');
    }
});

// Обработка команды /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const permissionLevel = await getUserPermissionLevel(chatId, userId);
        const entityType = isWednesday() ? 'жабу' : 'лоха';
        const buttonText = getButtonText();

        let helpMessage = `🆘 *Справка по боту*\n\n` +
            `🎲 *Основные команды:*\n` +
            `/start - Запуск бота и регистрация\n` +
            `/loser - Определить ${entityType} дня\n` +
            `/stats - Статистика чата\n` +
            `/help - Эта справка\n` +
            `/myid - Узнать свой Telegram ID\n\n` +
            `⚡ *Быстрые команды:*\n` +
            `• Кнопка "${buttonText}"\n\n` +
            `🎯 *Как пользоваться:*\n` +
            `1. Нажми кнопку или используй /loser\n` +
            `2. Смотри на анимацию\n` +
            `3. Узнай, кто сегодня ${entityType} дня!\n\n` +
            `Бот работает только в групповых чатах.`;

        // Добавляем команды для администраторов чата
        if (permissionLevel === 'CHAT_ADMIN' || permissionLevel === 'GLOBAL_ADMIN') {
            helpMessage += `\n\n🛡️ *Команды администратора чата:*\n` +
                `/immunity list - Список пользователей с иммунитетом\n` +
                `/immunity @user 7 - Выдать иммунитет на 7 дней\n` +
                `/immunity remove @user - Удалить иммунитет\n\n` +
                `Как администратор, вы можете управлять иммунитетом от выбора ${entityType}м.`;
        }

        // Добавляем команды для глобального администратора
        if (permissionLevel === 'GLOBAL_ADMIN') {
            helpMessage += `\n\n👑 *Команды глобального администратора:*\n` +
                `/broadcast - Выборочная рассылка сообщений\n` +
                `/backup - Создать резервную копию данных\n` +
                `/dbstats - Статистика базы данных\n` +
                `/dbstats reset - Сброс всей базы данных\n\n` +
                `🔧 *Администрирование:*\n` +
                `• Управляйте рассылками через /broadcast\n` +
                `• Создавайте backup через /backup\n` +
                `• Контролируйте данные через /dbstats`;
        }

        helpMessage += `\n\nВерсия: ${BOT_VERSION}`;

        await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        logAction('HELP_ERROR', error.message);
        await bot.sendMessage(chatId, 'Произошла ошибка при отображении справки.');
    }
});

// Обработка команды /stats
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const chat = botData.chats[chatId];
        if (!chat) {
            return bot.sendMessage(chatId, 'В этом чате ещё нет статистики.');
        }

        const currentLoser = getCurrentLoser(chatId);
        const entityType = isWednesday() ? 'Жаба' : 'Лох';

        let statsMessage = `📊 *Статистика чата*\n\n`;

        // Текущий лох/жаба
        if (currentLoser) {
            statsMessage += `👑 Текущий ${entityType.toLowerCase()} дня: ${currentLoser.username}\n\n`;
        }

        // Топ лохов
        const topLosers = Object.entries(botData.users)
            .filter(([userId, user]) => {
                const member = botData.users[userId];
                return member && member.loserCount > 0;
            })
            .sort((a, b) => b[1].loserCount - a[1].loserCount)
            .slice(0, 5);

        if (topLosers.length > 0) {
            statsMessage += `🏆 *Топ ${entityType.toLowerCase()}ов всех времён:*\n`;
            topLosers.forEach((entry, index) => {
                const [_, user] = entry;
                statsMessage += `${index + 1}. ${user.username} - ${user.loserCount} раз(а)\n`;
            });
        }

        // Общая статистика
        statsMessage += `\n📈 *Общая статистика:*\n` +
            `• Проверок: ${botData.stats.totalDiceRolls}\n` +
            `• Участников: ${Object.keys(botData.users).length}\n` +
            `• Первая проверка: ${new Date(chat.addedDate).toLocaleDateString()}\n`;

        await bot.sendMessage(chatId, statsMessage);
        

    } catch (error) {
        logAction('STATS_ERROR', error.message);
        await bot.sendMessage(chatId, 'Произошла ошибка при получении статистики.');
    }
});

// Обработка команды /myid
bot.onText(/\/myid/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    await bot.sendMessage(chatId, 
        `🆔 Ваш Telegram ID: \`${userId}\`\n` +
        `💭 Chat ID: \`${chatId}\``,
        { parse_mode: 'Markdown' }
    );
});

// Обработка кнопок детекции
bot.onText(/🎲 Задетектить сегодняшнего лоха|🐸 Ho is da dude today\?/, async (msg) => {
    if (msg.chat.type === 'private') {
        return bot.sendMessage(msg.chat.id,
            'Эта функция работает только в групповых чатах! Добавь меня в группу.'
        );
    }
    await detectLoser(msg.chat.id, msg.from.id);
});

// Обработка команды /loser
bot.onText(/\/loser/, async (msg) => {
    if (msg.chat.type === 'private') {
        return bot.sendMessage(msg.chat.id,
            'Эта функция работает только в групповых чатах! Добавь меня в группу.'
        );
    }
    await detectLoser(msg.chat.id, msg.from.id);
});

// ===== СИСТЕМА ИММУНИТЕТА =====

// Проверка наличия иммунитета у пользователя
function hasImmunity(chatId, userId) {
    if (!botData.immunity[chatId] || !botData.immunity[chatId][userId]) {
        return false;
    }

    const immunity = botData.immunity[chatId][userId];
    const currentDate = getCurrentDate();
    return immunity.expiryDate >= currentDate;
}

// Очистка просроченных иммунитетов
function cleanupExpiredImmunity() {
    const currentDate = getCurrentDate();
    let cleanupCount = 0;

    for (const chatId in botData.immunity) {
        for (const userId in botData.immunity[chatId]) {
            if (botData.immunity[chatId][userId].expiryDate < currentDate) {
                delete botData.immunity[chatId][userId];
                cleanupCount++;
            }
        }
        // Удаляем пустые чаты
        if (Object.keys(botData.immunity[chatId]).length === 0) {
            delete botData.immunity[chatId];
        }
    }

    if (cleanupCount > 0) {
        logAction('IMMUNITY_CLEANUP', `Удалено ${cleanupCount} просроченных иммунитетов`);
    }
}

// Парсинг аргументов команды иммунитета
function parseImmunityCommand(text) {
    const parts = text.split(' ').filter(part => part);
    if (parts.length < 2) return null;

    const command = parts[1].toLowerCase();
    const username = parts[2] ? parts[2].replace('@', '') : null;
    const days = parts[3] ? parseInt(parts[3]) : null;

    return { command, username, days };
}

// Обработчик команд иммунитета
bot.onText(/\/immunity(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Проверяем права администратора
        const permissionLevel = await getUserPermissionLevel(chatId, userId);
        if (permissionLevel !== 'CHAT_ADMIN' && permissionLevel !== 'GLOBAL_ADMIN') {
            return bot.sendMessage(chatId,
                '❌ У вас нет прав для управления иммунитетом.\n' +
                'Эта команда доступна только администраторам чата.'
            );
        }

        const args = parseImmunityCommand(msg.text);
        if (!args) {
            return bot.sendMessage(chatId,
                '⚠️ Неверный формат команды. Используйте:\n' +
                '/immunity list - список иммунитетов\n' +
                '/immunity @username 7 - выдать иммунитет на 7 дней\n' +
                '/immunity remove @username - удалить иммунитет'
            );
        }

        // Инициализация структуры иммунитета для чата
        if (!botData.immunity[chatId]) {
            botData.immunity[chatId] = {};
        }

        // Обработка подкоманд
        switch (args.command) {
            case 'list':
                // Список текущих иммунитетов
                const immunities = botData.immunity[chatId];
                if (!immunities || Object.keys(immunities).length === 0) {
                    return bot.sendMessage(chatId, '📋 В этом чате нет активных иммунитетов.');
                }

                let listMessage = '🛡️ *Список активных иммунитетов:*\n\n';
                for (const [userId, immunity] of Object.entries(immunities)) {
                    if (hasImmunity(chatId, userId)) {
                        listMessage += `• ${immunity.username} - до ${immunity.expiryDate}\n`;
                    }
                }

                await bot.sendMessage(chatId, listMessage, { parse_mode: 'Markdown' });
                break;

            case 'remove':
                // Удаление иммунитета
                if (!args.username) {
                    return bot.sendMessage(chatId, '⚠️ Укажите пользователя: /immunity remove @username');
                }

                // Поиск пользователя по имени
                let targetUserId = null;
                for (const [uid, immunity] of Object.entries(botData.immunity[chatId] || {})) {
                    if (immunity.username.replace('@', '') === args.username) {
                        targetUserId = uid;
                        break;
                    }
                }

                if (!targetUserId || !botData.immunity[chatId][targetUserId]) {
                    return bot.sendMessage(chatId, '❌ У этого пользователя нет активного иммунитета.');
                }

                delete botData.immunity[chatId][targetUserId];
                await bot.sendMessage(chatId, `✅ Иммунитет для ${args.username} успешно удален.`);
                break;

            default:
                // Выдача иммунитета
                if (!args.username) {
                    return bot.sendMessage(chatId, '⚠️ Укажите пользователя: /immunity @username 7');
                }

                if (!args.days || args.days < 1 || args.days > 30) {
                    return bot.sendMessage(chatId,
                        '⚠️ Укажите количество дней от 1 до 30:\n' +
                        '/immunity @username 7'
                    );
                }

                // Поиск пользователя в чате
                try {
                    const chatMembers = await bot.getChatAdministrators(chatId);
                    const targetUser = chatMembers.find(
                        member => member.user.username && 
                        member.user.username.toLowerCase() === args.username.toLowerCase()
                    );

                    if (!targetUser) {
                        return bot.sendMessage(chatId,
                            '❌ Пользователь не найден в администраторах чата.\n' +
                            'Иммунитет можно выдавать только администраторам.'
                        );
                    }

                    // Вычисляем дату окончания иммунитета
                    const currentDate = new Date();
                    const expiryDate = new Date();
                    expiryDate.setDate(currentDate.getDate() + args.days);

                    // Сохраняем иммунитет
                    botData.immunity[chatId][targetUser.user.id] = {
                        username: `@${targetUser.user.username}`,
                        expiryDate: expiryDate.toISOString().split('T')[0],
                        grantedDate: currentDate.toISOString().split('T')[0]
                    };

                    await bot.sendMessage(chatId,
                        `✅ Иммунитет выдан пользователю @${targetUser.user.username}\n` +
                        `📅 Действует до: ${expiryDate.toISOString().split('T')[0]}`
                    );

                    logAction('IMMUNITY_GRANT',
                        `Выдан иммунитет @${targetUser.user.username} в чате ${chatId} на ${args.days} дней`
                    );

                } catch (error) {
                    logAction('IMMUNITY_ERROR', error.message);
                    await bot.sendMessage(chatId,
                        '❌ Ошибка при выдаче иммунитета. Проверьте, что:\n' +
                        '1. Пользователь существует\n' +
                        '2. Бот имеет права администратора\n' +
                        '3. Имя пользователя указано верно'
                    );
                }
        }

    } catch (error) {
        logAction('IMMUNITY_ERROR', error.message);
        await bot.sendMessage(chatId, 'Произошла ошибка при работе с иммунитетом.');
    }
});

// ===== СИСТЕМА РАССЫЛОК =====

// Создание клавиатуры для выбора чатов
function createBroadcastKeyboard(selectedChats = []) {
    const chats = Object.entries(botData.chats)
        .filter(([chatId, chat]) => chat.title) // Только чаты с названиями
        .map(([chatId, chat]) => ({
            id: chatId,
            title: chat.title
        }));

    const keyboard = [];

    // Кнопка выбора всех чатов
    keyboard.push([{
        text: '📢 Все чаты',
        callback_data: 'broadcast_all'
    }]);

    // Кнопки для каждого чата
    chats.forEach(chat => {
        const isSelected = selectedChats.includes(chat.id);
        keyboard.push([{
            text: `${isSelected ? '✅' : '💭'} ${chat.title}`,
            callback_data: `broadcast_chat_${chat.id}`
        }]);
    });

    // Кнопки управления
    keyboard.push([
        {
            text: `✅ Продолжить (${selectedChats.length} чатов)`,
            callback_data: 'broadcast_confirm'
        }
    ]);
    keyboard.push([
        {
            text: '❌ Отмена',
            callback_data: 'broadcast_cancel'
        }
    ]);

    return {
        inline_keyboard: keyboard
    };
}

// Обработка команды /broadcast
bot.onText(/\/broadcast/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Проверяем права глобального администратора
        if (userId.toString() !== ADMIN_ID) {
            return bot.sendMessage(chatId,
                '❌ У вас нет прав для использования рассылки.\n' +
                'Эта команда доступна только глобальному администратору.'
            );
        }

        // Инициализируем состояние рассылки
        broadcastStates.set(userId, {
            step: 'selecting_chats',
            selectedChats: [],
            originalMessageId: null
        });

        // Отправляем сообщение с клавиатурой выбора чатов
        const message = await bot.sendMessage(chatId,
            '📢 *Создание рассылки*\n\n' +
            'Выберите чаты для отправки сообщения:\n' +
            '• Нажмите на чат для выбора\n' +
            '• "Все чаты" для выбора всех\n' +
            '• "Продолжить" когда закончите\n' +
            '• "Отмена" для отмены рассылки',
            {
                parse_mode: 'Markdown',
                reply_markup: createBroadcastKeyboard([])
            }
        );

        // Сохраняем ID сообщения для последующего обновления
        const state = broadcastStates.get(userId);
        state.originalMessageId = message.message_id;
        broadcastStates.set(userId, state);

    } catch (error) {
        logAction('BROADCAST_ERROR', error.message);
        await bot.sendMessage(chatId, 'Произошла ошибка при создании рассылки.');
    }
});

// Обработка callback-запросов для рассылки
bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const data = query.data;

    // Проверяем, что это callback для рассылки
    if (!data.startsWith('broadcast_')) {
        return;
    }

    try {
        // Проверяем права глобального администратора
        if (userId.toString() !== ADMIN_ID) {
            await bot.answerCallbackQuery(query.id, {
                text: '❌ У вас нет прав для управления рассылкой',
                show_alert: true
            });
            return;
        }

        // Получаем текущее состояние рассылки
        const state = broadcastStates.get(userId);
        if (!state) {
            await bot.answerCallbackQuery(query.id, {
                text: '❌ Сессия рассылки истекла. Начните заново',
                show_alert: true
            });
            return;
        }

        // Обработка разных действий
        if (data === 'broadcast_all') {
            // Выбираем все чаты
            state.selectedChats = Object.keys(botData.chats);
        } else if (data === 'broadcast_confirm') {
            // Подтверждение выбора
            if (state.selectedChats.length === 0) {
                await bot.answerCallbackQuery(query.id, {
                    text: '⚠️ Выберите хотя бы один чат',
                    show_alert: true
                });
                return;
            }

            // Переходим к следующему шагу
            state.step = 'waiting_message';
            await bot.editMessageText(
                '📝 Отправьте сообщение для рассылки:\n\n' +
                `📢 Будет отправлено в ${state.selectedChats.length} чатов\n` +
                '❌ Отправьте /cancel для отмены',
                {
                    chat_id: chatId,
                    message_id: state.originalMessageId,
                    reply_markup: { inline_keyboard: [] }
                }
            );

        } else if (data === 'broadcast_cancel') {
            // Отмена рассылки
            broadcastStates.delete(userId);
            await bot.editMessageText(
                '❌ Рассылка отменена',
                {
                    chat_id: chatId,
                    message_id: state.originalMessageId,
                    reply_markup: { inline_keyboard: [] }
                }
            );

        } else if (data.startsWith('broadcast_chat_')) {
            // Выбор/отмена выбора чата
            const selectedChatId = data.replace('broadcast_chat_', '');
            const index = state.selectedChats.indexOf(selectedChatId);

            if (index === -1) {
                state.selectedChats.push(selectedChatId);
            } else {
                state.selectedChats.splice(index, 1);
            }
        }

        // Обновляем клавиатуру если всё ещё выбираем чаты
        if (state.step === 'selecting_chats') {
            await bot.editMessageReplyMarkup(
                createBroadcastKeyboard(state.selectedChats),
                {
                    chat_id: chatId,
                    message_id: state.originalMessageId
                }
            );
        }

        // Сохраняем обновленное состояние
        broadcastStates.set(userId, state);
        await bot.answerCallbackQuery(query.id);

    } catch (error) {
        logAction('BROADCAST_CALLBACK_ERROR', error.message);
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Произошла ошибка',
            show_alert: true
        });
    }
});

// Обработка сообщений для рассылки
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    // Проверяем, ожидается ли сообщение для рассылки
    const state = broadcastStates.get(userId);
    if (!state || state.step !== 'waiting_message') {
        return;
    }

    // Проверяем команду отмены
    if (msg.text === '/cancel') {
        broadcastStates.delete(userId);
        await bot.sendMessage(chatId, '❌ Рассылка отменена');
        return;
    }

    try {
        // Начинаем рассылку
        await bot.sendMessage(chatId, '📢 Начинаю рассылку...');
        
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Отправляем сообщение в каждый выбранный чат
        for (const targetChatId of state.selectedChats) {
            try {
                await bot.copyMessage(targetChatId, chatId, msg.message_id);
                successCount++;
                // Небольшая задержка между отправками
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                errorCount++;
                errors.push(`${targetChatId}: ${error.message}`);
            }
        }

        // Отправляем отчет о рассылке
        let report = '📊 *Отчет о рассылке:*\n\n' +
            `✅ Успешно: ${successCount}\n` +
            `❌ Ошибок: ${errorCount}\n\n`;

        if (errors.length > 0) {
            report += '*Детали ошибок:*\n' + errors.join('\n');
        }

        await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
        
        // Очищаем состояние рассылки
        broadcastStates.delete(userId);

        logAction('BROADCAST_COMPLETE', 
            `Успешно: ${successCount}, Ошибок: ${errorCount}`
        );

    } catch (error) {
        logAction('BROADCAST_ERROR', error.message);
        await bot.sendMessage(chatId, 
            '❌ Произошла ошибка при рассылке.\n' +
            'Попробуйте позже или свяжитесь с разработчиком.'
        );
        broadcastStates.delete(userId);
    }
});

// ===== HTTP СЕРВЕР ДЛЯ МОНИТОРИНГА =====

// Создание HTTP сервера
const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
    }

    // Получаем время работы бота
    const uptime = new Date() - new Date(botData.stats.botStartTime);
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));

    // Формируем HTML страницу
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Детектор лоха v${BOT_VERSION}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 40px;
            background: #f5f5f5;
            color: #333;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .status {
            color: #28a745;
            font-weight: bold;
            padding: 10px;
            background: #e8f5e9;
            border-radius: 5px;
            margin: 20px 0;
        }
        .stats {
            margin: 20px 0;
            background: #f8f9fa;
            padding: 20px;
            border-radius: 5px;
        }
        .stat-item {
            margin: 10px 0;
            padding: 5px 0;
            border-bottom: 1px solid #eee;
        }
        .stat-item:last-child {
            border-bottom: none;
        }
        .footer {
            margin-top: 30px;
            color: #666;
            font-size: 0.9em;
        }
        @media (max-width: 600px) {
            body {
                margin: 20px;
            }
            .container {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎲 Детектор лоха v${BOT_VERSION}</h1>
        
        <div class="status">
            ✅ Бот работает нормально
        </div>

        <div class="stats">
            <h3>📊 Статистика:</h3>
            <div class="stat-item">👥 Пользователей: ${Object.keys(botData.users).length}</div>
            <div class="stat-item">💬 Чатов: ${Object.keys(botData.chats).length}</div>
            <div class="stat-item">🎲 Бросков кубика: ${botData.stats.totalDiceRolls}</div>
            <div class="stat-item">📨 Сообщений: ${botData.stats.totalMessages}</div>
            <div class="stat-item">⚡ Ошибок сохранения: ${botData.stats.saveErrors}</div>
            <div class="stat-item">⏰ Время работы: ${hours}ч ${minutes}м</div>
        </div>

        <div class="stats">
            <h3>💾 Информация о данных:</h3>
            <div class="stat-item">📅 Запуск бота: ${new Date(botData.stats.botStartTime).toLocaleString('ru-RU')}</div>
            <div class="stat-item">💾 Последнее сохранение: ${
                botData.stats.lastSaveTime 
                ? new Date(botData.stats.lastSaveTime).toLocaleString('ru-RU')
                : 'Нет данных'
            }</div>
        </div>

        <div class="footer">
            <p>🔄 Последнее обновление: ${new Date().toLocaleString('ru-RU')}</p>
            <p>👨‍💻 Разработчик: <a href="https://github.com/THRLNTLS" target="_blank">THRLNTLS</a></p>
        </div>
    </div>
</body>
</html>
    `;

    // Отправляем ответ
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
});

// Обработка ошибок сервера
server.on('error', (error) => {
    logAction('HTTP_SERVER_ERROR', error.message);
});

// ===== ИНИЦИАЛИЗАЦИЯ И ЗАПУСК =====

// Загрузка данных при старте
async function initializeBot() {
    logAction('BOT_INIT', 'Начало инициализации бота');

    try {
        // Загружаем данные из GitHub если доступно
        if (octokit) {
            const savedData = await loadFromGitHub('bot_data.json');
            if (savedData) {
                botData.chats = savedData.chats || {};
                botData.users = savedData.users || {};
                botData.immunity = savedData.immunity || {};
                botData.stats = {
                    ...savedData.stats,
                    botStartTime: new Date().toISOString(),
                    totalMessages: savedData.stats?.totalMessages || 0,
                    totalDiceRolls: savedData.stats?.totalDiceRolls || 0,
                    saveErrors: 0
                };
                logAction('BOT_INIT', 'Данные успешно загружены из GitHub');
            }
        }

        // Очищаем старые иммунитеты
        cleanupExpiredImmunity();

        // Настраиваем автосохранение
        setInterval(autoSave, AUTOSAVE_INTERVAL * 60 * 1000);

        // Запускаем HTTP сервер
        server.listen(PORT, () => {
            logAction('HTTP_SERVER', `Сервер запущен на порту ${PORT}`);
        });

        // Устанавливаем обработчики системных событий
        process.on('SIGINT', handleShutdown);
        process.on('SIGTERM', handleShutdown);

        // Обновляем команды бота
        await updateBotCommands();

        logAction('BOT_INIT', `Бот успешно инициализирован (v${BOT_VERSION})`);
        
        // Отправляем уведомление администратору
        if (ADMIN_ID) {
            const startMessage = 
                `🤖 *Бот запущен успешно*\n\n` +
                `📊 Статистика:\n` +
                `• Версия: ${BOT_VERSION}\n` +
                `• Чатов: ${Object.keys(botData.chats).length}\n` +
                `• Пользователей: ${Object.keys(botData.users).length}\n` +
                `• Порт: ${PORT}\n` +
                `• GitHub backup: ${octokit ? '✅' : '❌'}\n\n` +
                `🕒 Время запуска: ${new Date().toLocaleString('ru-RU')}`;

            await bot.sendMessage(ADMIN_ID, startMessage, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        logAction('BOT_INIT_ERROR', error.message);
        console.error('Ошибка при инициализации бота:', error);
        process.exit(1);
    }
}

// Обновление команд бота
async function updateBotCommands() {
    try {
        await bot.setMyCommands([
            { command: 'start', description: 'Запустить бота' },
            { command: 'help', description: 'Справка по командам' },
            { command: 'loser', description: 'Определить лоха дня' },
            { command: 'stats', description: 'Статистика чата' },
            { command: 'myid', description: 'Узнать свой Telegram ID' },
            { command: 'immunity', description: 'Управление иммунитетом' }
        ]);
        logAction('COMMANDS_UPDATE', 'Команды бота успешно обновлены');
    } catch (error) {
        logAction('COMMANDS_UPDATE_ERROR', error.message);
    }
}

// Обработка завершения работы
async function handleShutdown(signal) {
    logAction('SHUTDOWN', `Получен сигнал ${signal}`);
    
    try {
        // Сохраняем данные перед выключением
        await autoSave();
        
        // Отправляем уведомление администратору
        if (ADMIN_ID) {
            const shutdownMessage = 
                '🔴 *Бот завершает работу*\n\n' +
                `⚠️ Причина: Получен сигнал ${signal}\n` +
                `🕒 Время: ${new Date().toLocaleString('ru-RU')}`;

            await bot.sendMessage(ADMIN_ID, shutdownMessage, { parse_mode: 'Markdown' });
        }

        // Закрываем HTTP сервер
        server.close(() => {
            logAction('HTTP_SERVER', 'Сервер остановлен');
        });

        // Останавливаем бота
        bot.stopPolling();
        
        logAction('SHUTDOWN', 'Бот успешно завершил работу');
        
        // Даем время на отправку последних сообщений
        setTimeout(() => {
            process.exit(0);
        }, 1000);

    } catch (error) {
        logAction('SHUTDOWN_ERROR', error.message);
        process.exit(1);
    }
}

// Общий обработчик ошибок
process.on('uncaughtException', (error) => {
    logAction('UNCAUGHT_EXCEPTION', error.message);
    console.error('Необработанная ошибка:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logAction('UNHANDLED_REJECTION', reason?.message || 'Unknown reason');
    console.error('Необработанное отклонение промиса:', reason);
});

// Старт бота
initializeBot().catch(error => {
    console.error('Критическая ошибка при запуске бота:', error);
    process.exit(1);
});