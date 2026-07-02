local LrApplication = import("LrApplication")
local LrTasks = import("LrTasks")
local LrDialogs = import("LrDialogs")
local LrFileUtils = import("LrFileUtils")
local LrPathUtils = import("LrPathUtils")

local function processCSV(filePath)
    local results = {}
    local file, err = io.open(filePath, "r")
    if not file then
        return nil, err
    end

    local isFirstLine = true
    for line in file:lines() do
        if isFirstLine then
            isFirstLine = false
        else
            -- Simple CSV parser for "filename,rating,color"
            local idx = 1
            local filename, rating, color
            for val in string.gmatch(line, "[^,]+") do
                if idx == 1 then filename = val end
                if idx == 2 then rating = tonumber(val) end
                if idx == 3 then color = val end
                idx = idx + 1
            end

            if filename then
                -- Remove extension to match base name
                local baseName = LrPathUtils.removeExtension(filename)
                results[baseName] = {
                    rating = rating or 0,
                    color = color or "None"
                }
            end
        end
    end

    file:close()
    return results
end

local function applyCull()
    LrTasks.startAsyncTask(function()
        local csvPath = LrDialogs.runOpenPanel({
            title = "Выберите CSV файл с результатами Smart Cull",
            canChooseFiles = true,
            canChooseDirectories = false,
            allowsMultipleSelection = false,
            fileTypes = { "csv" }
        })

        if not csvPath or #csvPath == 0 then
            return
        end

        local cullData, err = processCSV(csvPath[1])
        if not cullData then
            LrDialogs.message("Ошибка чтения CSV", err, "critical")
            return
        end

        local catalog = LrApplication.activeCatalog()
        local targetPhotos = catalog:getTargetPhotos()

        if #targetPhotos == 0 then
            LrDialogs.message("Фотографии не выбраны", "Пожалуйста, выделите фотографии, к которым нужно применить результаты отбора, в режиме Сетки (Grid view).", "info")
            return
        end

        local matchedCount = 0

        catalog:withWriteAccessDo("Apply Smart Cull", function(context)
            for _, photo in ipairs(targetPhotos) do
                local filename = photo:getFormattedMetadata("fileName")
                if filename then
                    local baseName = LrPathUtils.removeExtension(filename)
                    local data = cullData[baseName]

                    if data then
                        if data.rating > 0 then
                            photo:setRawMetadata("rating", data.rating)
                        else
                            photo:setRawMetadata("rating", nil)
                        end

                        if data.color and data.color ~= "None" and data.color ~= "" then
                            -- Normalize color label strings based on standard Lightroom names
                            local lowerColor = string.lower(data.color)
                            if lowerColor == "red" then photo:setRawMetadata("colorNameForLabel", "Red")
                            elseif lowerColor == "yellow" then photo:setRawMetadata("colorNameForLabel", "Yellow")
                            elseif lowerColor == "green" then photo:setRawMetadata("colorNameForLabel", "Green")
                            elseif lowerColor == "blue" then photo:setRawMetadata("colorNameForLabel", "Blue")
                            elseif lowerColor == "purple" then photo:setRawMetadata("colorNameForLabel", "Purple")
                            else photo:setRawMetadata("colorNameForLabel", nil) end
                        else
                            photo:setRawMetadata("colorNameForLabel", nil)
                        end
                        matchedCount = matchedCount + 1
                    end
                end
            end
        end)

        LrDialogs.message("Smart Cull: Готово", string.format("Рейтинги и метки успешно применены к %d фото.", matchedCount), "info")
    end)
end

applyCull()
