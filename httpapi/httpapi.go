package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"strings"

	"github.com/go-playground/validator/v10"
)

var (
	validate      *validator.Validate
	usernameRegex = regexp.MustCompile("^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$")
)

// This init is used to create a validator and register validation-specific
// functionality for the HTTP API.
//
// A single validator instance is used, because it caches struct parsing.
func init() {
	validate = validator.New()
	validate.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		return name
	})
	validate.RegisterValidation("username", func(fl validator.FieldLevel) bool {
		f := fl.Field().Interface()
		str, ok := f.(string)
		if !ok {
			return false
		}
		if len(str) > 32 {
			return false
		}
		if len(str) < 1 {
			return false
		}
		return usernameRegex.MatchString(str)
	})
}

// Response represents a generic HTTP response.
type Response struct {
	Message string  `json:"message" validate:"required"`
	Errors  []Error `json:"errors,omitempty" validate:"required"`
}

// Error represents a scoped error to a user input.
type Error struct {
	Field string `json:"field" validate:"required"`
	Code  string `json:"code" validate:"required"`
}

// Write outputs a standardized format to an HTTP response body.
func Write(w http.ResponseWriter, status int, response Response) {
	buf := &bytes.Buffer{}
	enc := json.NewEncoder(buf)
	enc.SetEscapeHTML(true)
	err := enc.Encode(response)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, err = w.Write(buf.Bytes())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// Read decodes JSON from the HTTP request into the value provided.
// It uses go-validator to validate the incoming request body.
func Read(rw http.ResponseWriter, r *http.Request, value interface{}) bool {
	err := json.NewDecoder(r.Body).Decode(value)
	if err != nil {
		Write(rw, http.StatusBadRequest, Response{
			Message: fmt.Sprintf("read body: %s", err.Error()),
		})
		return false
	}
	err = validate.Struct(value)
	var validationErrors validator.ValidationErrors
	if errors.As(err, &validationErrors) {
		apiErrors := make([]Error, 0, len(validationErrors))
		for _, validationError := range validationErrors {
			apiErrors = append(apiErrors, Error{
				Field: validationError.Field(),
				Code:  validationError.Tag(),
			})
		}
		Write(rw, http.StatusBadRequest, Response{
			Message: "Validation failed",
			Errors:  apiErrors,
		})
		return false
	}
	if err != nil {
		Write(rw, http.StatusInternalServerError, Response{
			Message: fmt.Sprintf("validation: %s", err.Error()),
		})
		return false
	}
	return true
}
